/**
 * Translation-memory write-back, approval and the reuse log (migration 113).
 *
 * Every rule in this module exists because TM POISONING is the dominant risk in a
 * translation memory — well ahead of cache misses. One bad translation written back and
 * auto-applied propagates across every market and every future product, every subsequent
 * fuzzy match inherits it as a reference, and published snapshots carry it forward. There
 * is no un-poisoning pass. A memory that saves less but cannot poison itself is strictly
 * better than the inverse, and that trade is made explicitly here:
 *
 *   - Nothing this module writes is ever born `approved`. `recordTmSegments` writes
 *     `unreviewed`, full stop; approval is a separate, audited act.
 *   - An existing approved row's target is NEVER overwritten. If an incoming translation
 *     disagrees with approved wording, nothing is written and the disagreement is
 *     reported as a divergence for a human. This is the primary anti-poisoning valve:
 *     the interesting case is a vendor or a model quietly "improving" text a reviewer
 *     already signed off.
 *   - A correction is deprecate-then-insert, linked by `supersedes_id`, so published
 *     content keeps a traceable lineage instead of silently changing meaning underneath
 *     it. The replacement is NOT approved by the same call.
 *   - Approval is capped per batch and refuses mixed locales, because the failure mode
 *     that actually happens is somebody select-all-approving a queue of thousands of
 *     machine rows.
 *
 * The database enforces the same rules independently (RLS plus the governance trigger in
 * migration 113). The checks here exist so the UI can give a decent message before the
 * database raises, not instead of them.
 *
 * WHERE APPROVAL MUST RUN: in the browser, under the approving admin's own JWT, so that
 * RLS and the trigger both apply. Deliberately NOT behind a service-role Netlify
 * function — a service-role connection bypasses the trigger entirely (see the migration's
 * note on `auth.uid() is null`), so a server-side approval endpoint would be a hole in
 * the only control that cannot be retrofitted.
 */

import { db, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { normalizeLocale } from '../../config/im-locales';
import { saveWithRetry } from '../core/save-retry';
import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';
import { mapTmSegmentRow, type TmSegmentRecord } from './im-tm-lookup.service';
import type { PlaceholderType } from './im-tm-types';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An approval was refused before it reached the database. */
export class TmApprovalDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmApprovalDeniedError';
  }
}

/** An attempt to change an approved segment's linguistic payload in place. */
export class TmImmutableSegmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmImmutableSegmentError';
  }
}

/** A bulk approval larger than a human can plausibly have reviewed. */
export class TmBatchTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmBatchTooLargeError';
  }
}

/**
 * Ceiling on one approval call.
 *
 * Not a technical limit — a deliberate speed bump. The realistic way this corpus gets
 * poisoned is an operator facing a queue of several thousand `machine` rows, selecting
 * all, and approving. Reviewing fifty segments is plausible; reviewing five thousand in
 * one click is not, and the UI must never default-select the queue either.
 */
export const TM_APPROVAL_BATCH_LIMIT = 50;

// ---------------------------------------------------------------------------
// Write-back
// ---------------------------------------------------------------------------

export type TmOrigin = 'human' | 'machine' | 'imported' | 'supplier';

export interface RecordTmSegmentInput {
  sourceLocale: string;
  targetLocale: string;
  sourceKey: string;
  plainKey: string;
  contextKey: string | null;
  sourceFingerprint: string;
  placeholderedSource: string;
  rawSource: string;
  /** The PLACEHOLDERED target, not thawed HTML. See the migration's column comment. */
  targetText: string;
  placeholderTypes: PlaceholderType[];
  tokenIdentities: string[];
  placeholderSafe: boolean;
  container?: string | null;
  anchorPath?: string | null;
  domainCategoryId?: string | null;
  domainContentType?: string | null;
  origin: TmOrigin;
  regulatoryRefs?: string[];
  sourceRef?: string | null;
  /** Attribution. Server-stamped when the write goes through a function; see the docstring. */
  createdBy?: string | null;
}

/** An incoming translation that contradicts already-approved wording. */
export interface TmDivergence {
  segmentId: string;
  targetLocale: string;
  placeholderedSource: string;
  approvedTarget: string;
  submittedTarget: string;
}

export interface RecordTmResult {
  inserted: number;
  updatedUnreviewed: number;
  skippedApproved: number;
  skippedInvalid: number;
  divergences: TmDivergence[];
}

/**
 * Reject a row whose target could never be re-injected.
 *
 * Defence in depth against a too-generous `placeholderSafe` upstream: every placeholder
 * the source declared must appear in the target EXACTLY ONCE, and no others. Reassembly
 * enforces the same thing at read time, but catching it here means the corruption is
 * never stored in the first place — otherwise it surfaces months later, on a different
 * product, as a fragment that silently refuses to translate.
 */
const isStorable = (input: RecordTmSegmentInput): boolean => {
  if (!input.sourceKey || !input.placeholderedSource || !input.targetText.trim()) return false;

  const counts = new Map<number, number>();
  for (const marker of input.targetText.match(/\{\{P(\d+)\}\}/g) ?? []) {
    const index = Number(/\d+/.exec(marker)?.[0] ?? -1);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }

  const declared = input.placeholderTypes.length;
  if (counts.size !== declared) return false;
  for (let i = 0; i < declared; i++) {
    if (counts.get(i) !== 1) return false;
  }
  return true;
};

const toRow = (input: RecordTmSegmentInput): Record<string, unknown> => ({
  source_locale: normalizeLocale(input.sourceLocale),
  target_locale: normalizeLocale(input.targetLocale),
  source_key: input.sourceKey,
  plain_key: input.plainKey,
  context_key: input.contextKey,
  source_fingerprint: input.sourceFingerprint,
  placeholdered_source: input.placeholderedSource,
  raw_source: input.rawSource,
  target_text: input.targetText,
  placeholder_types: input.placeholderTypes,
  token_identities: input.tokenIdentities,
  placeholder_safe: input.placeholderSafe,
  container: input.container ?? null,
  anchor_path: input.anchorPath ?? null,
  domain_category_id: input.domainCategoryId ?? null,
  domain_content_type: input.domainContentType ?? null,
  origin: input.origin,
  // Never negotiable: this module cannot create an approved row.
  status: 'unreviewed',
  regulatory_refs: input.regulatoryRefs ?? [],
  segmentation_version: SEGMENTATION_VERSION,
  normalization_version: NORMALIZATION_VERSION,
  placeholder_version: PLACEHOLDER_VERSION,
  source_ref: input.sourceRef ?? null,
  created_by: input.createdBy ?? null,
  updated_at: new Date().toISOString(),
});

const dedupeKeyOf = (r: {
  sourceLocale: string;
  targetLocale: string;
  sourceKey: string;
  contextKey: string | null;
  domainCategoryId?: string | null;
  domainContentType?: string | null;
}): string =>
  [
    normalizeLocale(r.sourceLocale),
    normalizeLocale(r.targetLocale),
    r.sourceKey,
    r.contextKey ?? '',
    r.domainCategoryId ?? '',
    r.domainContentType ?? '',
    SEGMENTATION_VERSION,
  ].join(' ');

/**
 * Write translations into the memory as `unreviewed` candidates.
 *
 * Select-then-write rather than upsert: the dedupe index in migration 113 is PARTIAL
 * (`WHERE status <> 'deprecated'`), and PostgREST cannot express
 * `ON CONFLICT (cols) WHERE predicate`, so a partial index is not usable as a conflict
 * arbiter. A concurrent insert therefore races; the loser is reported rather than
 * retried into a duplicate.
 */
export const recordTmSegments = async (
  inputs: readonly RecordTmSegmentInput[],
): Promise<RecordTmResult> => {
  const result: RecordTmResult = {
    inserted: 0,
    updatedUnreviewed: 0,
    skippedApproved: 0,
    skippedInvalid: 0,
    divergences: [],
  };
  if (!isLive || !inputs.length) return result;

  const storable = inputs.filter((i) => {
    if (isStorable(i)) return true;
    result.skippedInvalid++;
    return false;
  });
  if (!storable.length) return result;

  // Read the rows these writes could collide with, in one query.
  const existingRows = await db.select<Row>('im_tm_segments', {
    where: {
      source_key: [...new Set(storable.map((i) => i.sourceKey))],
      target_locale: [...new Set(storable.map((i) => normalizeLocale(i.targetLocale)))],
      status: ['approved', 'unreviewed'],
    },
  });
  const existing = new Map<string, TmSegmentRecord>();
  for (const row of existingRows) {
    const rec = mapTmSegmentRow(row);
    existing.set(dedupeKeyOf(rec), rec);
  }

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; values: Record<string, unknown> }> = [];

  for (const input of storable) {
    const prior = existing.get(dedupeKeyOf(input));

    if (!prior) {
      toInsert.push(toRow(input));
      continue;
    }

    if (prior.status === 'approved') {
      if (prior.targetText !== input.targetText) {
        // THE anti-poisoning valve. A vendor or a model disagreeing with approved
        // wording is either a real error report (valuable) or tool noise (whitespace
        // and entity normalization) — both need a human, and silently accepting either
        // would let the memory be poisoned against its own approved content.
        result.divergences.push({
          segmentId: prior.id,
          targetLocale: prior.targetLocale,
          placeholderedSource: prior.placeholderedSource,
          approvedTarget: prior.targetText,
          submittedTarget: input.targetText,
        });
      }
      result.skippedApproved++;
      continue;
    }

    // An unreviewed row may be refreshed in place — it has no authority yet.
    if (prior.targetText === input.targetText) continue;
    toUpdate.push({
      id: prior.id,
      values: {
        target_text: input.targetText,
        origin: input.origin,
        source_ref: input.sourceRef ?? null,
        created_by: input.createdBy ?? prior.createdBy,
        updated_at: new Date().toISOString(),
      },
    });
  }

  if (toInsert.length) {
    const bytes = JSON.stringify(toInsert).length;
    await saveWithRetry(
      (timeoutMs) =>
        withDeadline(
          (signal) => db.insertMany('im_tm_segments', toInsert, { signal }),
          timeoutMs,
          'recordTmSegments',
        ),
      { context: 'recordTmSegments', payloadBytes: bytes },
    );
    result.inserted = toInsert.length;
  }

  for (const u of toUpdate) {
    await db.updateWhere('im_tm_segments', u.values, { where: { id: u.id } });
    result.updatedUnreviewed++;
  }

  return result;
};

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * Approve segments so they become eligible for auto-apply.
 *
 * Must run in the browser under the approving admin's own JWT — see the module docstring.
 * The database re-checks admin role and reviewer presence; these checks only produce a
 * better message.
 */
export const approveTmSegments = async (
  ids: readonly string[],
  reviewer: { email: string },
): Promise<number> => {
  if (!ids.length) return 0;
  if (!reviewer?.email) {
    throw new TmApprovalDeniedError('An approval must record who reviewed it.');
  }
  if (ids.length > TM_APPROVAL_BATCH_LIMIT) {
    throw new TmBatchTooLargeError(
      'Approve at most ' + TM_APPROVAL_BATCH_LIMIT + ' segments at a time — '
      + ids.length + ' were selected. Bulk-approving machine output is how a translation '
      + 'memory gets poisoned, and it cannot be undone for content already published.',
    );
  }
  if (!isLive) return 0;

  const rows = await db.select<Row>('im_tm_segments', {
    where: { id: [...ids] },
    columns: 'id, target_locale, status',
  });
  const locales = new Set(rows.map((r) => normalizeLocale(r.target_locale)));
  if (locales.size > 1) {
    // Reviewing German and Polish wording in one action means at least one of them was
    // not actually reviewed.
    throw new TmApprovalDeniedError(
      'Approve one target locale at a time — this selection spans ' + [...locales].join(', ') + '.',
    );
  }
  const already = rows.filter((r) => r.status === 'approved').map((r) => r.id);
  const pending = rows.filter((r) => r.status === 'unreviewed').map((r) => r.id);
  if (already.length) {
    console.warn('[im-tm-write] ' + already.length + ' segment(s) were already approved; skipping them.');
  }
  if (!pending.length) return 0;

  const now = new Date().toISOString();
  await db.updateWhere(
    'im_tm_segments',
    { status: 'approved', reviewed_by: reviewer.email, reviewed_at: now, updated_at: now },
    { where: { id: pending } },
  );
  return pending.length;
};

/** Retire a segment from all future retrieval. Published content is NOT rewritten. */
export const deprecateTmSegments = async (
  ids: readonly string[],
  reason: string,
): Promise<number> => {
  if (!ids.length) return 0;
  if (!reason?.trim()) {
    throw new TmApprovalDeniedError('Deprecating a segment requires a reason — it is the audit trail.');
  }
  if (!isLive) return 0;
  const now = new Date().toISOString();
  await db.updateWhere(
    'im_tm_segments',
    { status: 'deprecated', deprecated_at: now, deprecated_reason: reason.trim(), updated_at: now },
    { where: { id: [...ids] } },
  );
  return ids.length;
};

/**
 * Correct an approved segment: deprecate the old row, insert an unreviewed replacement
 * linked by `supersedes_id`.
 *
 * Deliberately does NOT approve the replacement. A correction is exactly the moment when
 * a second pair of eyes is worth most, and auto-approving it would reintroduce the
 * "unreviewed text becomes authoritative" path the whole design excludes.
 */
export const replaceApprovedTmSegment = async (
  id: string,
  newTargetText: string,
  reason: string,
): Promise<TmSegmentRecord | null> => {
  if (!newTargetText.trim()) {
    throw new TmImmutableSegmentError('A replacement needs a target text.');
  }
  if (!reason?.trim()) {
    throw new TmImmutableSegmentError('Replacing an approved segment requires a reason.');
  }
  if (!isLive) return null;

  const prior = mapTmSegmentRow(await db.selectOne<Row>('im_tm_segments', { where: { id } }));
  const now = new Date().toISOString();

  await db.updateWhere(
    'im_tm_segments',
    { status: 'deprecated', deprecated_at: now, deprecated_reason: reason.trim(), updated_at: now },
    { where: { id } },
  );

  const created = await db.insert<Row>('im_tm_segments', {
    source_locale: prior.sourceLocale,
    target_locale: prior.targetLocale,
    source_key: prior.sourceKey,
    plain_key: prior.plainKey,
    context_key: prior.contextKey,
    source_fingerprint: prior.sourceFingerprint,
    placeholdered_source: prior.placeholderedSource,
    raw_source: prior.rawSource,
    target_text: newTargetText,
    placeholder_types: prior.placeholderTypes,
    token_identities: prior.tokenIdentities,
    placeholder_safe: prior.placeholderSafe,
    container: prior.container,
    anchor_path: prior.anchorPath,
    domain_category_id: prior.domainCategoryId,
    domain_content_type: prior.domainContentType,
    origin: 'human',
    status: 'unreviewed',
    regulatory_refs: prior.regulatoryRefs,
    segmentation_version: SEGMENTATION_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    placeholder_version: PLACEHOLDER_VERSION,
    supersedes_id: prior.id,
    updated_at: now,
  });
  return mapTmSegmentRow(created);
};

/** Bump usage counters atomically. Read-modify-write from a concurrent pool loses increments. */
export const noteTmSegmentsUsed = async (ids: readonly string[]): Promise<void> => {
  if (!isLive || !ids.length) return;
  await db.rpc<void>('im_tm_note_used', { p_ids: [...new Set(ids)] });
};

// ---------------------------------------------------------------------------
// Reuse log
// ---------------------------------------------------------------------------

export type TmRunKind = 'ai' | 'xliff_export' | 'xliff_import' | 'manual';
export type TmTierName = 'perfect' | 'exact' | 'fuzzy_high' | 'fuzzy_low' | 'miss';

export interface TmReuseEvent {
  runId: string;
  runKind: TmRunKind;
  scope: 'template' | 'block' | 'project';
  templateId?: string | null;
  blockId?: string | null;
  projectId?: string | null;
  templateType?: string | null;
  fragmentId?: string | null;
  segmentIndex: number;
  sourceLocale: string;
  targetLocale: string;
  tier: TmTierName;
  matchPercent: number | null;
  localeDistance: number;
  matchedSegmentId: string | null;
  applied: boolean;
  referenceOnly: boolean;
  domainCategoryId?: string | null;
  domainContentType?: string | null;
  /** Character count of the source segment — the leverage denominator. */
  sourceChars: number;
  decidedBy?: string | null;
}

/**
 * Map the retrieval tiers onto the log's reporting vocabulary.
 *
 * The pure layer distinguishes `fuzzy_auto` from `fuzzy_review`, but for cost reporting
 * what matters is the fuzzy BAND, and the `applied` flag already records whether it was
 * used without a model call.
 */
export const reuseTierFor = (tier: string): TmTierName => {
  if (tier === 'exact_in_context') return 'perfect';
  if (tier === 'exact') return 'exact';
  if (tier === 'fuzzy_auto' || tier === 'fuzzy_review') return 'fuzzy_high';
  if (tier === 'reference') return 'fuzzy_low';
  return 'miss';
};

/**
 * Append reuse decisions to the audit log.
 *
 * Logged even on a miss: a log that only records hits cannot answer "what is our leverage",
 * because the denominator is missing. Failure to log warns and does not fail the caller's
 * run — the translations are real work that should not be thrown away over a log write —
 * but the caller is expected to surface "N reuse events not recorded" rather than imply a
 * clean audit trail.
 */
export const logTmReuse = async (events: readonly TmReuseEvent[]): Promise<number> => {
  if (!isLive || !events.length) return 0;
  const rows = events.map((e) => ({
    run_id: e.runId,
    run_kind: e.runKind,
    scope: e.scope,
    template_id: e.templateId ?? null,
    block_id: e.blockId ?? null,
    project_id: e.projectId ?? null,
    template_type: e.templateType ?? null,
    fragment_id: e.fragmentId ?? null,
    segment_index: e.segmentIndex,
    source_locale: normalizeLocale(e.sourceLocale),
    target_locale: normalizeLocale(e.targetLocale),
    tier: e.tier,
    match_percent: e.matchPercent,
    locale_distance: e.localeDistance,
    matched_segment_id: e.matchedSegmentId,
    applied: e.applied,
    reference_only: e.referenceOnly,
    domain_category_id: e.domainCategoryId ?? null,
    domain_content_type: e.domainContentType ?? null,
    source_chars: e.sourceChars,
    decided_by: e.decidedBy ?? null,
  }));
  try {
    await db.insertMany('im_tm_reuse_log', rows);
    return rows.length;
  } catch (e) {
    console.warn('[im-tm-write] failed to record ' + rows.length + ' reuse event(s).', e);
    return 0;
  }
};
