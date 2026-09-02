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
import type {
  Regulation, RegulationInput, RegulationStatus, RegulationStructure,
} from '../../types';
import { getRegulationStructure, getRegulationStructures } from './regulation-clause.service';

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
  'id,title,reference_code,jurisdiction,notes,summary,tcf_description,checklist,' +
  'summary_file_name,summary_bytes,summary_uploaded_at,summary_uploaded_by,' +
  'applicable_categories,status,superseded_by_id,expired_at,expired_reason,' +
  'version,edition_year,issued_at,' +
  'last_amended_at,source_url,celex_id,version_state,version_checked_at,version_detail,' +
  'review_due_at,created_by,created_at,updated_at';

const mapRow = (r: any): Regulation => ({
  id: r.id,
  title: r.title,
  referenceCode: r.reference_code,
  jurisdiction: r.jurisdiction ?? undefined,
  notes: r.notes ?? undefined,
  // The short human summary and the TCF obligation text are both in LIST_COLUMNS: they are
  // a paragraph each and are exactly what the library list and the TCF need to show without
  // a second read. `summary_md` stays excluded — that one is the whole regulation.
  summary: r.summary ?? undefined,
  tcfDescription: r.tcf_description ?? undefined,
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
  expiredAt: r.expired_at ?? null,
  expiredReason: r.expired_reason ?? undefined,
  version: r.version ?? undefined,
  editionYear: r.edition_year ?? null,
  issuedAt: r.issued_at ?? null,
  lastAmendedAt: r.last_amended_at ?? null,
  sourceUrl: r.source_url ?? undefined,
  celexId: r.celex_id ?? undefined,
  versionState: r.version_state ?? null,
  versionCheckedAt: r.version_checked_at ?? null,
  versionDetail: r.version_detail ?? null,
  reviewDueAt: r.review_due_at ?? null,
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
  /** TCF requirements pointing at this regulation (migration 139). */
  tcfCount: number;
  constructor(usageCount: number, viaCategory = false, tcfCount = 0) {
    const users = [
      usageCount > 0 ? `${usageCount} IM template(s)` : '',
      tcfCount > 0 ? `${tcfCount} TCF requirement(s)` : '',
    ].filter(Boolean).join(' and ');
    super(
      `Cannot delete: ${users} currently answer for this regulation. ` +
      (viaCategory
        ? `Untick its categories (and unassign it from any template that names it directly), `
        : `Unassign it everywhere first, `) +
      `or mark it superseded to retire it while keeping existing assignments, TCF links ` +
      `and past check reports intact.`,
    );
    this.name = 'RegulationInUseError';
    this.usageCount = usageCount;
    this.viaCategory = viaCategory;
    this.tcfCount = tcfCount;
  }
}

/**
 * The library list. Excludes `summary_md` — see the file header. `categoryId` filters on
 * `applicable_categories`, which is LOAD-BEARING since migration 116: an active regulation
 * listing a category applies to that category's IM templates automatically.
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
  // Clauses and obligations come along (migration 141) because essentially every consumer
  // needs them: the library counts obligations, the pre-publish checklist is built from them,
  // and the detail page groups by clause. Two flat selects for the whole library beat one
  // round trip per regulation, and `getRegulationStructures` never rejects — a failed
  // structure read leaves `obligations` undefined and the checklist falls back to the legacy
  // `checklist` text rather than silently reporting zero obligations.
  const structures = await getRegulationStructures();
  return rows.map(mapRow).map(r => attachStructure(r, structures.get(r.id)));
};

/** Attach a regulation's clauses and obligations, leaving them undefined when unknown. */
const attachStructure = (
  regulation: Regulation,
  structure: RegulationStructure | undefined,
): Regulation => (structure
  ? { ...regulation, clauses: structure.clauses, obligations: structure.obligations }
  : regulation);

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
  if (!row) return undefined;
  return attachStructure(mapRow(row), await getRegulationStructure(id));
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
  if (input.summary !== undefined) payload.summary = input.summary?.trim() || null;
  if (input.tcfDescription !== undefined) payload.tcf_description = input.tcfDescription?.trim() || null;
  if (input.checklist !== undefined) payload.checklist = input.checklist?.trim() || null;
  if (input.version !== undefined) payload.version = input.version?.trim() || null;
  if (input.editionYear !== undefined) payload.edition_year = input.editionYear ?? null;
  // Dates are stored as DATE, so an empty string must become NULL rather than reaching
  // Postgres as '' and failing the whole write with a type error.
  if (input.issuedAt !== undefined) payload.issued_at = input.issuedAt || null;
  if (input.lastAmendedAt !== undefined) payload.last_amended_at = input.lastAmendedAt || null;
  if (input.reviewDueAt !== undefined) payload.review_due_at = input.reviewDueAt || null;
  if (input.sourceUrl !== undefined) payload.source_url = input.sourceUrl?.trim() || null;
  if (input.celexId !== undefined) payload.celex_id = input.celexId?.trim().toUpperCase() || null;
  if (input.applicableCategories !== undefined) payload.applicable_categories = input.applicableCategories;
  if (input.status !== undefined) payload.status = input.status;
  if (input.supersededById !== undefined) payload.superseded_by_id = input.supersededById || null;
  if (input.expiredReason !== undefined) payload.expired_reason = input.expiredReason?.trim() || null;
  // DATE column, so an empty string must become NULL rather than reaching Postgres as ''.
  if (input.expiredAt !== undefined) payload.expired_at = input.expiredAt || null;
  // An expiry with no date gives a block message that cannot say when this became true, so
  // today is stamped rather than leaving it blank. Only ever fills a gap: an explicit date
  // in the same write wins, and clearing the status clears nothing retrospectively.
  if (input.status === 'expired' && !payload.expired_at && input.expiredAt === undefined) {
    payload.expired_at = new Date().toISOString().slice(0, 10);
  }

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
    getRegulations(),
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
    // Everything except 'superseded' derives by category — expired regulations included, so
    // that expiring one BLOCKS its templates rather than quietly dropping off their lists
    // (migration 140). Superseded is the retire path and must not reach new templates.
    if (regulation.status === 'superseded') continue;
    for (const cat of regulation.applicableCategories) {
      for (const templateId of templatesByCategory.get(cat) ?? []) add(regulation.id, templateId);
    }
  }

  const counts: Record<string, number> = {};
  for (const [regulationId, set] of perRegulation) counts[regulationId] = set.size;
  return counts;
};

/**
 * TCF requirements citing each regulation, keyed by regulation id (migration 139).
 *
 * The other half of "who answers for this regulation". A regulation can have no IM
 * template at all and still be the reason a supplier is asked for an EMC report, so the
 * library's usage figure would be a lie without it.
 */
export const getRegulationTcfCounts = async (): Promise<Record<string, number>> => {
  if (!isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('compliance_requirements', { columns: 'regulation_id', signal }),
      READ_TIMEOUT_MS,
      'getRegulationTcfCounts',
    ),
    `${TAG} getRegulationTcfCounts`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.regulation_id) continue;
    counts[r.regulation_id] = (counts[r.regulation_id] ?? 0) + 1;
  }
  return counts;
};

/**
 * Delete a regulation, refusing while anything still answers for it — an explicit IM
 * assignment, a ticked category, or a TCF requirement that cites it.
 *
 * The category half has no foreign key behind it, so this pre-check is the only thing
 * preventing a silent deletion from emptying what several templates are checked against.
 * `ON DELETE RESTRICT` backs the explicit IM half and, since migration 139, the TCF half
 * too — including the race where a link appears between the check and the delete.
 */
export const deleteRegulation = async (id: string): Promise<void> => {
  const explicit = await db.count('im_template_regulations', { where: { regulation_id: id } });
  const [usage, tcfCounts] = await Promise.all([
    getRegulationUsageCounts(),
    getRegulationTcfCounts(),
  ]);
  const effective = usage[id] ?? explicit;
  const tcf = tcfCounts[id] ?? 0;
  if (effective > 0 || tcf > 0) {
    console.warn(TAG, `deleteRegulation blocked — ${id} used by ${effective} template(s), ${tcf} TCF requirement(s)`);
    throw new RegulationInUseError(effective, effective > explicit, tcf);
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
    if (/23503|foreign key|violates/i.test(message)) throw new RegulationInUseError(1, false, 0);
    console.error(TAG, 'deleteRegulation failed', e);
    throw e;
  }
};
