/**
 * Per-template regulation assignment — CRUD over `im_template_regulations`.
 *
 * Assignment is per TEMPLATE (one `im_templates` row = one category + one template
 * type), not per category: a category's IM and its warning leaflet carry different
 * obligations, and the leaflet is exactly the document a "must appear in the printed
 * matter accompanying the appliance" clause lands on.
 *
 * `notes` is a scope note for this template only ("only Annex IV applies — this family
 * is not free-standing"). It is interpolated into the regulatory-check system prompt,
 * so it narrows what the model reports; it is not decoration.
 *
 * Reads deliberately do TWO queries and stitch, rather than one PostgREST embedded
 * join: src/data/PORTING.md inventories every embedded join as work a non-PostgREST
 * adapter owes, and two portable reads cost one extra round trip and add none.
 */

import { db, withDeadline, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { Regulation, TemplateRegulation } from '../../types';
import { getRegulations } from './regulation.service';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

const mapRow = (r: any, regulation?: Regulation): TemplateRegulation => ({
  id: r.id,
  templateId: r.template_id,
  regulationId: r.regulation_id,
  notes: r.notes ?? undefined,
  assignedBy: r.assigned_by ?? undefined,
  createdAt: r.created_at,
  regulation,
});

/**
 * The regulations assigned to one template, each with its library row stitched in.
 * Ordered by reference code so the list reads the same as the library.
 */
export const getTemplateRegulations = async (templateId: string): Promise<TemplateRegulation[]> => {
  if (!templateId || !isLive) return [];

  const rows = await orEmpty(
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
  );
  if (!rows.length) return [];

  // Second read, stitched client-side — see the file header on embedded joins.
  // `getRegulations` excludes summary_md, which is right here: the assignment UI shows
  // a size, and the check reads the summary server-side.
  const library = await getRegulations();
  const byId = new Map(library.map((r) => [r.id, r]));

  return rows
    .map((r) => mapRow(r, byId.get(r.regulation_id)))
    .sort((a, b) =>
      (a.regulation?.referenceCode ?? '').localeCompare(b.regulation?.referenceCode ?? ''));
};

/** How many regulations each template has assigned, keyed by template id. */
export const getTemplateRegulationCounts = async (): Promise<Record<string, number>> => {
  if (!isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_template_regulations', {
        columns: 'template_id',
        signal,
      }),
      READ_TIMEOUT_MS,
      'getTemplateRegulationCounts',
    ),
    `${TAG} getTemplateRegulationCounts`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.template_id] = (counts[r.template_id] ?? 0) + 1;
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

export const updateTemplateRegulationNotes = async (id: string, notes: string): Promise<void> => {
  await db.updateWhere(
    'im_template_regulations',
    { notes: notes.trim() || null, updated_at: new Date().toISOString() },
    { where: { id } },
  );
};

export const unassignRegulationFromTemplate = async (id: string): Promise<void> => {
  await db.delete('im_template_regulations', { where: { id } });
};
