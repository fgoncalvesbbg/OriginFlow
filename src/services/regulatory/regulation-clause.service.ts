/**
 * Clauses and obligations — reading and writing the two levels below a regulation
 * (migration 141).
 *
 * READ SHAPE. `getRegulationStructures()` fetches BOTH tables whole, in two selects, and
 * stitches by regulation id. That is the right shape and not laziness: the live library is
 * 20 regulations, 25 clauses and 66 obligations, the library list already needs every
 * regulation's obligations to show a count, and per-regulation reads would turn one page
 * render into 20 round trips. `src/data/PORTING.md` also counts every PostgREST embedded
 * join as work a non-PostgREST adapter owes, and two flat selects owe nothing.
 *
 * SORTING. Clause numbers are dotted decimals, where string order is wrong in the one way
 * people notice: "7.2" sorts before "7.12". `clauseSortKey` pads each segment so the stored
 * `sort_key` orders correctly in SQL and in JS, without either side needing to know the rule.
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  ClauseKind,
  ObligationCarrier,
  RegulationClause,
  RegulationClauseInput,
  RegulationObligation,
  RegulationObligationInput,
  RegulationStructure,
} from '../../types';
import { CARRIERS } from './obligation-parse';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

/** Width each clause segment is padded to. Four digits covers "7.2101" in IEC part standards. */
const SEGMENT_WIDTH = 4;

/**
 * A sortable key for a clause citation.
 *
 * "7.2" -> "0007.0002" and "7.12" -> "0007.0012", so the numeric order survives string
 * comparison. A non-numeric citation ("Annex II") keeps its own text after a "~" prefix,
 * which sorts after every digit in ASCII — annexes belong at the end of a standard, which is
 * also where they are printed.
 */
export const clauseSortKey = (number: string): string => {
  const trimmed = (number ?? '').trim();
  if (!trimmed) return '~';
  if (/^\d+(\.\d+)*$/.test(trimmed)) {
    return trimmed.split('.').map(seg => seg.padStart(SEGMENT_WIDTH, '0')).join('.');
  }
  return `~${trimmed.toLowerCase()}`;
};

/** Guess a clause kind from its citation, so the picker starts on the right value. */
export const inferClauseKind = (number: string): ClauseKind => {
  const t = (number ?? '').trim().toLowerCase();
  if (t.startsWith('annex')) return 'annex';
  if (t.startsWith('article') || t.startsWith('art.')) return 'article';
  if (t.startsWith('part')) return 'part';
  return 'clause';
};

/** Keep only values in the closed carrier vocabulary — a stored typo would hide an obligation. */
const cleanCarriers = (values: readonly string[] | undefined): ObligationCarrier[] => {
  if (!values) return [];
  const allowed = new Set<string>(CARRIERS);
  const out: ObligationCarrier[] = [];
  for (const v of values) {
    if (allowed.has(v) && !out.includes(v as ObligationCarrier)) out.push(v as ObligationCarrier);
  }
  return out;
};

const mapClause = (r: any): RegulationClause => ({
  id: r.id,
  regulationId: r.regulation_id,
  number: r.number,
  qualifier: r.qualifier ?? undefined,
  title: r.title ?? undefined,
  kind: (r.kind ?? 'clause') as ClauseKind,
  sortKey: r.sort_key ?? clauseSortKey(r.number),
  summary: r.summary ?? undefined,
  tcfDescription: r.tcf_description ?? undefined,
  amendedIn: r.amended_in ?? undefined,
  lastChangedAt: r.last_changed_at ?? null,
  sourceAnchor: r.source_anchor ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapObligation = (r: any): RegulationObligation => ({
  id: r.id,
  regulationId: r.regulation_id,
  clauseId: r.clause_id ?? null,
  text: r.text,
  verbatim: r.verbatim ?? undefined,
  carriers: cleanCarriers(r.carriers),
  optionalCarriers: cleanCarriers(r.optional_carriers),
  sortOrder: r.sort_order ?? 0,
  note: r.note ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Order clauses the way the document prints them. */
export const compareClauses = (a: RegulationClause, b: RegulationClause): number =>
  a.sortKey.localeCompare(b.sortKey) || a.number.localeCompare(b.number);

/**
 * Every clause and obligation in the library, keyed by regulation id.
 *
 * Never rejects: a failed read returns empty maps, so the library still renders and the
 * checklist falls back to the legacy `regulations.checklist` text rather than showing nothing.
 */
export const getRegulationStructures = async (): Promise<Map<string, RegulationStructure>> => {
  const out = new Map<string, RegulationStructure>();
  if (!isLive) return out;

  const [clauseRows, obligationRows] = await Promise.all([
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('regulation_clauses', { order: { column: 'sort_key' }, signal }),
        READ_TIMEOUT_MS,
        'getRegulationStructures:clauses',
      ),
      `${TAG} getRegulationStructures`,
    ),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('regulation_obligations', { order: { column: 'sort_order' }, signal }),
        READ_TIMEOUT_MS,
        'getRegulationStructures:obligations',
      ),
      `${TAG} getRegulationStructures`,
    ),
  ]);

  const bucket = (id: string): RegulationStructure => {
    const existing = out.get(id);
    if (existing) return existing;
    const fresh: RegulationStructure = { clauses: [], obligations: [] };
    out.set(id, fresh);
    return fresh;
  };

  for (const row of clauseRows) bucket((row as any).regulation_id).clauses.push(mapClause(row));
  for (const row of obligationRows) bucket((row as any).regulation_id).obligations.push(mapObligation(row));
  for (const structure of out.values()) structure.clauses.sort(compareClauses);

  return out;
};

/** One regulation's structure. Same fallback contract as the batch read. */
export const getRegulationStructure = async (
  regulationId: string,
): Promise<RegulationStructure> => {
  if (!regulationId || !isLive) return { clauses: [], obligations: [] };

  const [clauseRows, obligationRows] = await Promise.all([
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('regulation_clauses', {
          where: { regulation_id: regulationId }, order: { column: 'sort_key' }, signal,
        }),
        READ_TIMEOUT_MS,
        'getRegulationStructure:clauses',
      ),
      `${TAG} getRegulationStructure`,
    ),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('regulation_obligations', {
          where: { regulation_id: regulationId }, order: { column: 'sort_order' }, signal,
        }),
        READ_TIMEOUT_MS,
        'getRegulationStructure:obligations',
      ),
      `${TAG} getRegulationStructure`,
    ),
  ]);

  return {
    clauses: clauseRows.map(mapClause).sort(compareClauses),
    obligations: obligationRows.map(mapObligation),
  };
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const clausePayload = (input: Partial<RegulationClauseInput>): Row => {
  const payload: Row = {};
  if (input.number !== undefined) {
    payload.number = input.number.trim();
    // Recomputed on every number change rather than stored once: a renumbered clause that
    // kept its old sort key would sit in the wrong place with nothing to explain why.
    payload.sort_key = clauseSortKey(input.number);
  }
  if (input.qualifier !== undefined) payload.qualifier = input.qualifier?.trim() || null;
  if (input.title !== undefined) payload.title = input.title?.trim() || null;
  if (input.kind !== undefined) payload.kind = input.kind;
  if (input.summary !== undefined) payload.summary = input.summary?.trim() || null;
  if (input.tcfDescription !== undefined) payload.tcf_description = input.tcfDescription?.trim() || null;
  if (input.amendedIn !== undefined) payload.amended_in = input.amendedIn?.trim() || null;
  // DATE column: '' must reach Postgres as NULL, not as an empty string.
  if (input.lastChangedAt !== undefined) payload.last_changed_at = input.lastChangedAt || null;
  if (input.sourceAnchor !== undefined) payload.source_anchor = input.sourceAnchor?.trim() || null;
  return payload;
};

/** Turn the duplicate-citation violation into a sentence an operator can act on. */
const describeClauseFailure = (e: unknown, number?: string): Error => {
  const message = e instanceof Error ? e.message : String(e);
  if (/duplicate key|already exists|23505|uq_regulation_clauses_number/i.test(message)) {
    return new Error(
      `This regulation already has a clause "${number ?? ''}". Open that one and edit it — ` +
      `two half-filled entries for the same clause split the obligations that belong together.`,
    );
  }
  return e instanceof Error ? e : new Error(message);
};

export const createClause = async (
  regulationId: string,
  input: RegulationClauseInput,
  actor?: string,
): Promise<RegulationClause> => {
  const payload = {
    ...clausePayload(input),
    regulation_id: regulationId,
    kind: input.kind ?? inferClauseKind(input.number),
    created_by: actor ?? null,
  };
  try {
    const row = await db.insert<Row>('regulation_clauses', payload);
    return mapClause(row);
  } catch (e) {
    console.error(TAG, 'createClause failed', e);
    throw describeClauseFailure(e, input.number);
  }
};

export const updateClause = async (
  id: string,
  updates: Partial<RegulationClauseInput>,
): Promise<void> => {
  const payload = clausePayload(updates);
  if (Object.keys(payload).length === 0) return;
  payload.updated_at = new Date().toISOString();
  try {
    await db.updateWhere('regulation_clauses', payload, { where: { id } });
  } catch (e) {
    console.error(TAG, 'updateClause failed', e);
    throw describeClauseFailure(e, updates.number);
  }
};

/**
 * Delete a clause. Its obligations survive with `clause_id = NULL` (ON DELETE SET NULL) —
 * losing a chapter heading must not delete the obligations stated under it.
 */
export const deleteClause = async (id: string): Promise<void> => {
  await db.delete('regulation_clauses', { where: { id } });
};

const obligationPayload = (input: Partial<RegulationObligationInput>): Row => {
  const payload: Row = {};
  if (input.text !== undefined) payload.text = input.text.trim();
  if (input.clauseId !== undefined) payload.clause_id = input.clauseId || null;
  if (input.verbatim !== undefined) payload.verbatim = input.verbatim?.trim() || null;
  if (input.carriers !== undefined) payload.carriers = cleanCarriers(input.carriers);
  if (input.optionalCarriers !== undefined) {
    const required = new Set(cleanCarriers(input.carriers));
    // A carrier can never be both. Required wins, because it is the stronger claim.
    payload.optional_carriers = cleanCarriers(input.optionalCarriers).filter(c => !required.has(c));
  }
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder;
  if (input.note !== undefined) payload.note = input.note?.trim() || null;
  return payload;
};

export const createObligation = async (
  regulationId: string,
  input: RegulationObligationInput,
  actor?: string,
): Promise<RegulationObligation> => {
  const row = await db.insert<Row>('regulation_obligations', {
    ...obligationPayload(input),
    regulation_id: regulationId,
    created_by: actor ?? null,
  });
  return mapObligation(row);
};

export const updateObligation = async (
  id: string,
  updates: Partial<RegulationObligationInput>,
): Promise<void> => {
  const payload = obligationPayload(updates);
  if (Object.keys(payload).length === 0) return;
  payload.updated_at = new Date().toISOString();
  await db.updateWhere('regulation_obligations', payload, { where: { id } });
};

export const deleteObligation = async (id: string): Promise<void> => {
  await db.delete('regulation_obligations', { where: { id } });
};
