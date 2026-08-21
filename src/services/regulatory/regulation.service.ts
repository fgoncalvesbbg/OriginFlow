/**
 * Regulation library service — CRUD over the global `regulations` table (migration 115).
 *
 * One row per regulation or regulatory guideline, with an operator-uploaded Markdown
 * summary stored as TEXT. The summary is read by the server-side regulatory check on
 * every run, which is why it lives in a column rather than a storage object.
 *
 * Two things here are load-bearing rather than incidental:
 *
 *  - THE LIST QUERY EXCLUDES `summary_md`. A summary is up to 400 kB; without an
 *    explicit projection, opening the library would download every one of them. So
 *    `getRegulations()` returns rows whose `summaryMd` is UNDEFINED — that is not a
 *    missing summary, and callers that need the text must use `getRegulationById()`.
 *    `summaryBytes` exists precisely so a list row can still show a size.
 *
 *  - DELETING AN ASSIGNED REGULATION IS REFUSED, not cascaded — the same rule as an
 *    in-use im_block, and for the same reason: silently emptying a dozen templates'
 *    regulation lists is a worse outcome than a loud refusal. `ON DELETE RESTRICT`
 *    enforces it in the database; the pre-check here exists to give a useful message.
 *    Retire a superseded regulation with `status: 'superseded'` instead.
 *
 * Writes are admin-only by RLS ("Admin write"). The UI hides the write affordances
 * for non-admins so a PM never sees an opaque policy error.
 */

import { db, withDeadline, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { Regulation, RegulationInput, RegulationStatus } from '../../types';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

/** Hard ceiling, matching the `regulations_summary_size` CHECK constraint. */
export const MAX_SUMMARY_BYTES = 400_000;
/** Above this, every check call carries a big prompt — worth warning about, not refusing. */
export const SUMMARY_WARN_BYTES = 150_000;

/**
 * Explicit projection for list reads: every column EXCEPT `summary_md`. A plain
 * comma-separated list, not PostgREST embed syntax, so it stays portable (see
 * src/data/PORTING.md).
 */
const LIST_COLUMNS =
  'id,title,reference_code,jurisdiction,notes,checklist,summary_file_name,summary_bytes,' +
  'summary_uploaded_at,summary_uploaded_by,applicable_categories,status,' +
  'superseded_by_id,created_by,created_at,updated_at';

const mapRow = (r: any): Regulation => ({
  id: r.id,
  title: r.title,
  referenceCode: r.reference_code,
  jurisdiction: r.jurisdiction ?? undefined,
  notes: r.notes ?? undefined,
  // Included in LIST_COLUMNS on purpose: the pre-publish checklist is built from the
  // assignment list's rows, and a few lines of text per regulation is nothing like a summary.
  checklist: r.checklist ?? undefined,
  // Absent on list rows by design — see LIST_COLUMNS.
  summaryMd: r.summary_md ?? undefined,
  summaryFileName: r.summary_file_name ?? undefined,
  summaryBytes: r.summary_bytes ?? 0,
  summaryUploadedAt: r.summary_uploaded_at ?? undefined,
  summaryUploadedBy: r.summary_uploaded_by ?? undefined,
  applicableCategories: r.applicable_categories ?? [],
  status: (r.status ?? 'active') as RegulationStatus,
  supersededById: r.superseded_by_id ?? null,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Byte length of a summary, matching the DB's `octet_length` rather than `.length`. */
export const summaryByteLength = (md: string): number => new TextEncoder().encode(md).length;

export class RegulationInUseError extends Error {
  code = 'REGULATION_IN_USE' as const;
  usageCount: number;
  /** True when at least part of the usage comes from a category marking, not a row. */
  viaCategory: boolean;
  constructor(usageCount: number, viaCategory = false) {
    super(
      `Cannot delete: ${usageCount} IM template(s) currently answer for this regulation. ` +
      (viaCategory
        ? `Untick its categories (and unassign it from any template that names it directly), `
        : `Unassign it everywhere first, `) +
      `or mark it superseded to retire it while keeping existing assignments and past ` +
      `check reports intact.`,
    );
    this.name = 'RegulationInUseError';
    this.usageCount = usageCount;
    this.viaCategory = viaCategory;
  }
}

/**
 * The library list. Excludes `summary_md` — see the file header. `categoryId` filters
 * on `applicable_categories`, which is a picker hint only.
 */
export const getRegulations = async (filters?: {
  status?: RegulationStatus;
  categoryId?: string;
}): Promise<Regulation[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('regulations', {
        columns: LIST_COLUMNS,
        where: {
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.categoryId
            ? { applicable_categories: { op: 'arrayContains' as const, value: [filters.categoryId] } }
            : {}),
        },
        order: { column: 'reference_code' },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getRegulations',
    ),
    `${TAG} getRegulations`,
  );
  return rows.map(mapRow);
};

/** The full row INCLUDING `summary_md`. For the edit dialog and the summary preview. */
export const getRegulationById = async (id: string): Promise<Regulation | undefined> => {
  if (!id || !isLive) return undefined;
  const row = await orUndefined(
    withDeadline(
      (signal) => db.selectMaybeOne<Row>('regulations', { where: { id }, signal }),
      READ_TIMEOUT_MS,
      'getRegulationById',
    ),
    `${TAG} getRegulationById`,
  );
  return row ? mapRow(row) : undefined;
};

/**
 * Build the write payload shared by create and update. `summaryMd` is tri-state:
 * a string replaces it (and re-stamps the provenance columns), `null` clears it,
 * `undefined` leaves it untouched — so editing a title never silently drops a summary.
 */
const buildPayload = (
  input: Partial<RegulationInput>,
  actor?: string,
): Row => {
  const payload: Row = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.referenceCode !== undefined) payload.reference_code = input.referenceCode.trim();
  if (input.jurisdiction !== undefined) payload.jurisdiction = input.jurisdiction?.trim() || null;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
  if (input.checklist !== undefined) payload.checklist = input.checklist?.trim() || null;
  if (input.applicableCategories !== undefined) payload.applicable_categories = input.applicableCategories;
  if (input.status !== undefined) payload.status = input.status;
  if (input.supersededById !== undefined) payload.superseded_by_id = input.supersededById || null;

  if (input.summaryMd !== undefined) {
    if (input.summaryMd === null || input.summaryMd === '') {
      payload.summary_md = null;
      payload.summary_bytes = 0;
      payload.summary_file_name = null;
      payload.summary_uploaded_at = null;
      payload.summary_uploaded_by = null;
    } else {
      const bytes = summaryByteLength(input.summaryMd);
      if (bytes > MAX_SUMMARY_BYTES) {
        // Refused here as well as by the CHECK constraint, so the operator gets a
        // sentence instead of a constraint-violation message.
        throw new Error(
          `The Markdown summary is ${Math.round(bytes / 1024)} kB; the limit is ` +
          `${Math.round(MAX_SUMMARY_BYTES / 1024)} kB. Trim it to the clauses that ` +
          `actually govern the manual.`,
        );
      }
      payload.summary_md = input.summaryMd;
      payload.summary_bytes = bytes;
      payload.summary_uploaded_at = new Date().toISOString();
      if (input.summaryFileName !== undefined) payload.summary_file_name = input.summaryFileName || null;
      if (actor) payload.summary_uploaded_by = actor;
    }
  } else if (input.summaryFileName !== undefined) {
    payload.summary_file_name = input.summaryFileName || null;
  }

  return payload;
};

/** Turn the unique-reference-code violation into a sentence an operator can act on. */
const describeWriteFailure = (e: unknown, referenceCode?: string): Error => {
  const message = e instanceof Error ? e.message : String(e);
  if (/duplicate key|already exists|23505|uq_regulations_reference_code/i.test(message)) {
    return new Error(
      `A regulation with the reference code "${referenceCode ?? ''}" already exists. ` +
      `Open that one and edit it instead — two half-filled rows for the same regulation ` +
      `means a template can be checked against the emptier of the two.`,
    );
  }
  return e instanceof Error ? e : new Error(message);
};

export const createRegulation = async (
  input: RegulationInput,
  createdBy?: string,
): Promise<Regulation> => {
  const payload = buildPayload(input, createdBy);
  payload.updated_at = new Date().toISOString();
  if (createdBy) payload.created_by = createdBy;
  try {
    const row = await db.insert<Row>('regulations', payload);
    if (!row) throw new Error('createRegulation: no data returned');
    return mapRow(row);
  } catch (e) {
    console.error(TAG, 'createRegulation failed', e);
    throw describeWriteFailure(e, input.referenceCode);
  }
};

export const updateRegulation = async (
  id: string,
  updates: Partial<RegulationInput>,
  actor?: string,
): Promise<void> => {
  const payload = buildPayload(updates, actor);
  payload.updated_at = new Date().toISOString();
  try {
    await db.updateWhere('regulations', payload, { where: { id } });
  } catch (e) {
    console.error(TAG, 'updateRegulation failed', e);
    throw describeWriteFailure(e, updates.referenceCode);
  }
};

/**
 * Templates that currently answer for each regulation, keyed by regulation id.
 *
 * EFFECTIVE usage, not just explicit rows: a regulation marked for a category applies to
 * that category's templates automatically, so counting only `im_template_regulations`
 * would report 0 for a regulation half a dozen templates are being checked against.
 */
export const getRegulationUsageCounts = async (): Promise<Record<string, number>> => {
  if (!isLive) return {};

  const [assignments, templates, library] = await Promise.all([
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_template_regulations', {
          columns: 'regulation_id,template_id',
          signal,
        }),
        READ_TIMEOUT_MS,
        'getRegulationUsageCounts:assignments',
      ),
      `${TAG} getRegulationUsageCounts`,
    ),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_templates', { columns: 'id,category_id', signal }),
        READ_TIMEOUT_MS,
        'getRegulationUsageCounts:templates',
      ),
      `${TAG} getRegulationUsageCounts`,
    ),
    getRegulations({ status: 'active' }),
  ]);

  // templateIds per regulation, so a template that is both explicitly assigned and
  // covered by the category counts once.
  const perRegulation = new Map<string, Set<string>>();
  const add = (regulationId: string, templateId: string) => {
    const set = perRegulation.get(regulationId) ?? new Set<string>();
    set.add(templateId);
    perRegulation.set(regulationId, set);
  };

  for (const a of assignments) add(a.regulation_id, a.template_id);

  const templatesByCategory = new Map<string, string[]>();
  for (const t of templates) {
    if (!t.category_id) continue;
    const list = templatesByCategory.get(t.category_id) ?? [];
    list.push(t.id);
    templatesByCategory.set(t.category_id, list);
  }
  for (const regulation of library) {
    for (const cat of regulation.applicableCategories) {
      for (const templateId of templatesByCategory.get(cat) ?? []) add(regulation.id, templateId);
    }
  }

  const counts: Record<string, number> = {};
  for (const [regulationId, set] of perRegulation) counts[regulationId] = set.size;
  return counts;
};

/**
 * Delete a regulation, refusing while any template still answers for it — whether by an
 * explicit assignment or because one of its categories is ticked.
 *
 * The category half has no foreign key behind it, so this pre-check is the only thing
 * preventing a silent deletion from emptying what several templates are checked against.
 * `ON DELETE RESTRICT` still backs the explicit half, including the race where an
 * assignment appears between the check and the delete.
 */
export const deleteRegulation = async (id: string): Promise<void> => {
  const explicit = await db.count('im_template_regulations', { where: { regulation_id: id } });
  const effective = (await getRegulationUsageCounts())[id] ?? explicit;
  if (effective > 0) {
    console.warn(TAG, `deleteRegulation blocked — ${id} used by ${effective} template(s)`);
    throw new RegulationInUseError(effective, effective > explicit);
  }
  try {
    await withDeadline(
      (signal) => db.delete('regulations', { where: { id }, signal }),
      READ_TIMEOUT_MS,
      'deleteRegulation',
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The FK fired, so an assignment appeared after the pre-check.
    if (/23503|foreign key|violates/i.test(message)) throw new RegulationInUseError(1);
    console.error(TAG, 'deleteRegulation failed', e);
    throw e;
  }
};
