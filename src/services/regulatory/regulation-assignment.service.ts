/**
 * Which regulations an IM template must satisfy.
 *
 * A template's effective list is the UNION of two sources:
 *
 *  - 'category'  — the regulation is marked for the template's category
 *                  (`regulations.applicable_categories` contains `im_templates.category_id`)
 *                  and is not 'superseded'. Derived at read time; there is no row.
 *                  EXPIRED regulations are deliberately still derived (migration 140): if
 *                  expiry removed them from the list, marking one expired would quietly
 *                  make a template report one FEWER obligation instead of blocking its
 *                  publish — the exact opposite of what expiry is for.
 *  - 'explicit'  — a real `im_template_regulations` row, created by assigning the
 *                  regulation to THIS template. Only an explicit row can carry a
 *                  per-template scope note.
 *
 * Category marking used to be a picker hint only, which meant marking "Induction hob"
 * on four regulations left the induction-hob template still reporting zero. Operators
 * reasonably read marking a category as associating the regulation, so it now does.
 * The known cost, accepted deliberately: a check can run against a regulation nobody
 * attached to that specific template, and the IM and the warning leaflet of one category
 * can no longer answer for different category-marked sets. Per-template control is still
 * available by assigning explicitly (and by unmarking the category).
 *
 * An explicit row always WINS over the derived entry for the same regulation, because it
 * is the one carrying the scope note. `id` is the row id for explicit entries and the
 * synthetic `derived:<regulationId>` for category ones — never treat a derived id as a
 * database key.
 *
 * Reads deliberately do several small portable queries and stitch, rather than one
 * PostgREST embedded join: src/data/PORTING.md inventories every embedded join as work a
 * non-PostgREST adapter owes, and extra round trips add none.
 */

import { db, withDeadline, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { Regulation, TemplateRegulation } from '../../types';
import { getRegulations } from './regulation.service';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

/** Synthetic id for a category-derived entry. Never a database key. */
export const derivedAssignmentId = (regulationId: string) => `derived:${regulationId}`;

/** True when an id came from `derivedAssignmentId` rather than a real row. */
export const isDerivedAssignmentId = (id: string) => id.startsWith('derived:');

const mapRow = (r: any, regulation?: Regulation): TemplateRegulation => ({
  id: r.id,
  templateId: r.template_id,
  regulationId: r.regulation_id,
  notes: r.notes ?? undefined,
  assignedBy: r.assigned_by ?? undefined,
  createdAt: r.created_at,
  source: 'explicit',
  regulation,
});

const mapDerived = (
  templateId: string,
  regulation: Regulation,
): TemplateRegulation => ({
  id: derivedAssignmentId(regulation.id),
  templateId,
  regulationId: regulation.id,
  notes: undefined,
  createdAt: regulation.updatedAt,
  source: 'category',
  regulation,
});

/**
 * The regulations a template must satisfy — explicit rows plus everything marked for
 * `categoryId`. Ordered by reference code so the list reads like the library.
 *
 * `categoryId` is required to resolve the category-derived half; pass the template's
 * `categoryId` (null/'' for the category-less blank template, which then gets explicit
 * assignments only).
 */
export const getTemplateRegulations = async (
  templateId: string,
  categoryId?: string | null,
): Promise<TemplateRegulation[]> => {
  if (!templateId || !isLive) return [];

  const [rows, library] = await Promise.all([
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_template_regulations', {
          where: { template_id: templateId },
          order: { column: 'created_at' },
          signal,
        }),
        READ_TIMEOUT_MS,
        'getTemplateRegulations',
      ),
      `${TAG} getTemplateRegulations`,
    ),
    // One library read serves both halves. It excludes summary_md by design — the
    // assignment UI shows a size, and the check reads the summary server-side.
    getRegulations(),
  ]);

  const byId = new Map(library.map((r) => [r.id, r]));
  const explicit = rows.map((r) => mapRow(r, byId.get(r.regulation_id)));
  const explicitRegIds = new Set(explicit.map((e) => e.regulationId));

  // Only ACTIVE regulations flow in by category: 'superseded' is how a regulation is
  // retired, and a retired one must stop reaching new templates. An explicit row to a
  // superseded regulation is deliberately left alone — someone chose it.
  const derived = categoryId
    ? library
        .filter((r) =>
          r.status !== 'superseded' &&
          !explicitRegIds.has(r.id) &&
          r.applicableCategories.includes(categoryId))
        .map((r) => mapDerived(templateId, r))
    : [];

  return [...explicit, ...derived].sort((a, b) =>
    (a.regulation?.referenceCode ?? '').localeCompare(b.regulation?.referenceCode ?? ''));
};

/**
 * Effective regulation count per template id, counting category-derived entries as well
 * as explicit rows — so the dashboard badge matches what the modal lists.
 */
export const getTemplateRegulationCounts = async (): Promise<Record<string, number>> => {
  if (!isLive) return {};

  const [assignments, templates, library] = await Promise.all([
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_template_regulations', {
          columns: 'template_id,regulation_id',
          signal,
        }),
        READ_TIMEOUT_MS,
        'getTemplateRegulationCounts:assignments',
      ),
      `${TAG} getTemplateRegulationCounts`,
    ),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_templates', { columns: 'id,category_id', signal }),
        READ_TIMEOUT_MS,
        'getTemplateRegulationCounts:templates',
      ),
      `${TAG} getTemplateRegulationCounts`,
    ),
    getRegulations(),
  ]);

  // regulationIds per template, so a regulation both explicitly assigned AND
  // category-marked is counted once.
  const perTemplate = new Map<string, Set<string>>();
  const add = (templateId: string, regulationId: string) => {
    const set = perTemplate.get(templateId) ?? new Set<string>();
    set.add(regulationId);
    perTemplate.set(templateId, set);
  };

  for (const a of assignments) add(a.template_id, a.regulation_id);

  // Index the library by category once, rather than scanning it per template.
  const byCategory = new Map<string, string[]>();
  for (const reg of library) {
    // Same rule as getTemplateRegulations: not 'superseded'. Expired regulations stay in the
    // count because they still apply — that is what makes them blocking (migration 140).
    if (reg.status === 'superseded') continue;
    for (const cat of reg.applicableCategories) {
      const list = byCategory.get(cat) ?? [];
      list.push(reg.id);
      byCategory.set(cat, list);
    }
  }
  for (const t of templates) {
    if (!t.category_id) continue;
    for (const regId of byCategory.get(t.category_id) ?? []) add(t.id, regId);
  }

  const counts: Record<string, number> = {};
  for (const [templateId, set] of perTemplate) counts[templateId] = set.size;
  return counts;
};

export const assignRegulationToTemplate = async (
  templateId: string,
  regulationId: string,
  notes?: string,
  assignedBy?: string,
): Promise<void> => {
  const now = new Date().toISOString();
  try {
    await db.insertMany('im_template_regulations', [{
      template_id: templateId,
      regulation_id: regulationId,
      notes: notes?.trim() || null,
      ...(assignedBy !== undefined && { assigned_by: assignedBy }),
      updated_at: now,
    }]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // uq_im_template_regulations_pair — a double-click or a stale list, not a real failure.
    if (/duplicate key|23505|uq_im_template_regulations_pair/i.test(message)) {
      throw new Error('That regulation is already assigned to this template.');
    }
    console.error(TAG, 'assignRegulationToTemplate failed', e);
    throw e;
  }
};

/**
 * Set the scope note on an assignment.
 *
 * A category-derived entry has no row to update, so passing its synthetic id
 * MATERIALIZES it: the explicit row is created carrying the note. That is the intended
 * way to narrow one template's scope for a regulation that arrived by category — the
 * explicit row then wins over the derived entry.
 */
export const updateTemplateRegulationNotes = async (
  id: string,
  notes: string,
  context?: { templateId: string; regulationId: string; actor?: string },
): Promise<void> => {
  if (isDerivedAssignmentId(id)) {
    if (!context) {
      throw new Error(
        'A scope note on a category-derived regulation needs the template and regulation ' +
        'ids so the assignment can be materialized.',
      );
    }
    await assignRegulationToTemplate(context.templateId, context.regulationId, notes, context.actor);
    return;
  }
  await db.updateWhere(
    'im_template_regulations',
    { notes: notes.trim() || null, updated_at: new Date().toISOString() },
    { where: { id } },
  );
};

/**
 * Remove an EXPLICIT assignment. A category-derived entry has no row to delete — it goes
 * away by unmarking the category on the regulation itself — so this refuses rather than
 * silently doing nothing.
 */
export const unassignRegulationFromTemplate = async (id: string): Promise<void> => {
  if (isDerivedAssignmentId(id)) {
    throw new Error(
      'This regulation applies because it is marked for this category. Remove the category ' +
      'from the regulation in the Regulations library to stop it applying here.',
    );
  }
  await db.delete('im_template_regulations', { where: { id } });
};
