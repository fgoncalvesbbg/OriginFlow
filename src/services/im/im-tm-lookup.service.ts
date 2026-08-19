/**
 * Translation-memory retrieval (im_tm_segments, migration 113).
 *
 * Implements the tier cascade in front of the translation engine:
 *
 *   perfect  source + context + domain match, approved   -> apply, no model call
 *   exact    source matches, context/domain differ       -> apply, flag for spot-check
 *   fuzzy    near-identical source                       -> hand the engine a minimal-edit reference
 *   miss     nothing usable                              -> full translation
 *
 * The scoring and tier rules themselves live in im-tm-similarity.ts, which is pure and
 * exhaustively tested; this module only fetches candidates and applies the database-side
 * facts (approval status, stored versions, locale distance) that the pure layer needs.
 *
 * TWO THINGS THIS MODULE WILL NOT DO
 * ---------------------------------
 * 1. It never auto-applies a row that is not `approved`. A 100% text match on unreviewed
 *    machine output comes back as a REFERENCE. TM poisoning is the dominant risk here,
 *    well ahead of cache misses: one bad translation written back and auto-applied
 *    propagates across every market and every future product, and every subsequent fuzzy
 *    match inherits the error as its reference. A memory that saves less but cannot
 *    poison itself is strictly better than the inverse.
 * 2. It never reports the trigram score. The database's `%` recall filter is
 *    character-based and would rate '2.5 l' against '25 l' as a near match; every
 *    percentage this module returns comes from the token-level scorer. Mixing the two
 *    would make the reported leverage disagree with what an operator sees on screen.
 *
 * FAILURE POLICY: a TM outage degrades to `miss` and lets the translate run proceed. This
 * is the one place in the design where swallowing an error is right — the memory is an
 * optimization, and failing a whole mass-translate because a cache lookup timed out
 * would be a worse outcome than paying for the translation. The degradation is reported
 * (`stats.unavailable`) so it is visible rather than silent.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { localeDistance, localeFallbackChain, normalizeLocale } from '../../config/im-locales';
import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';
import {
  TM_CANDIDATE_MIN,
  TM_SUGGEST_MIN,
  isAutoApplicable,
  prefilterPass,
  scoreMatch,
  tierFor,
  tokenizeForCompare,
} from './im-tm-similarity';
import type { CompareToken, MatchTier, PlaceholderType, ScoreResult } from './im-tm-types';

/** A stored memory row, camelCased. */
export interface TmSegmentRecord {
  id: string;
  sourceLocale: string;
  targetLocale: string;
  sourceKey: string;
  plainKey: string;
  contextKey: string | null;
  sourceFingerprint: string;
  placeholderedSource: string;
  rawSource: string;
  targetText: string;
  placeholderTypes: string[];
  tokenIdentities: string[];
  placeholderSafe: boolean;
  container: string | null;
  anchorPath: string | null;
  domainCategoryId: string | null;
  domainContentType: string | null;
  origin: 'human' | 'machine' | 'imported' | 'supplier';
  status: 'unreviewed' | 'approved' | 'deprecated';
  regulatoryRefs: string[];
  segmentationVersion: number;
  normalizationVersion: number;
  placeholderVersion: number;
  usageCount: number;
  reviewedBy: string | null;
  createdBy: string | null;
}

export const mapTmSegmentRow = (r: any): TmSegmentRecord => ({
  id: r.id,
  sourceLocale: r.source_locale,
  targetLocale: r.target_locale,
  sourceKey: r.source_key,
  plainKey: r.plain_key,
  contextKey: r.context_key ?? null,
  sourceFingerprint: r.source_fingerprint,
  placeholderedSource: r.placeholdered_source,
  rawSource: r.raw_source,
  targetText: r.target_text,
  placeholderTypes: r.placeholder_types ?? [],
  tokenIdentities: r.token_identities ?? [],
  placeholderSafe: r.placeholder_safe ?? false,
  container: r.container ?? null,
  anchorPath: r.anchor_path ?? null,
  domainCategoryId: r.domain_category_id ?? null,
  domainContentType: r.domain_content_type ?? null,
  origin: r.origin,
  status: r.status,
  regulatoryRefs: r.regulatory_refs ?? [],
  segmentationVersion: r.segmentation_version ?? 0,
  normalizationVersion: r.normalization_version ?? 0,
  placeholderVersion: r.placeholder_version ?? 0,
  usageCount: r.usage_count ?? 0,
  reviewedBy: r.reviewed_by ?? null,
  createdBy: r.created_by ?? null,
});

/** What the caller wants translated. One per (segment, target locale). */
export interface TmLookupRequest {
  /** Caller-chosen, stable within a run. Convention: `${fragmentId}#${segmentIndex}#${targetLocale}`. */
  key: string;
  sourceLocale: string;
  targetLocale: string;
  sourceKey: string;
  plainKey: string;
  contextKey: string | null;
  placeholderedSource: string;
  placeholderTypes: PlaceholderType[];
  placeholderSafe: boolean;
  domainCategoryId?: string | null;
  domainContentType?: string | null;
  /** Precomputed by im-tm-core; saves re-tokenizing per candidate. */
  compareTokens: CompareToken[];
}

export interface TmMatch {
  tier: MatchTier;
  /** Token-level percentage. Null on a miss. Never a trigram score. */
  matchPercent: number | null;
  segment: TmSegmentRecord | null;
  /** May be written into content with no model call. */
  autoApply: boolean;
  /** May be handed to the model as a minimal-edit reference. */
  referenceOnly: boolean;
  localeDistance: number;
  score: ScoreResult | null;
  /** Human-readable reason the tier was demoted, for the run report. */
  reason: string;
}

const MISS: TmMatch = {
  tier: 'none',
  matchPercent: null,
  segment: null,
  autoApply: false,
  referenceOnly: false,
  localeDistance: -1,
  score: null,
  reason: 'no candidate',
};

export interface TmLookupCache {
  get(key: string): TmMatch;
  readonly stats: Record<string, number>;
  /** True when the memory could not be read and every result is a forced miss. */
  readonly unavailable: boolean;
}

/**
 * Segments shorter than this skip the fuzzy stage entirely: a three-word heading is
 * within 70% of almost anything, so fuzzy recall on it is pure noise and cost.
 */
const MIN_FUZZY_CHARS = 25;
/** Ceiling on fuzzy RPC calls per run, so a large first-time run cannot melt the database. */
const MAX_FUZZY_CALLS = 120;

// ---------------------------------------------------------------------------
// Candidate evaluation
// ---------------------------------------------------------------------------

const versionsMatch = (s: TmSegmentRecord): boolean =>
  s.segmentationVersion === SEGMENTATION_VERSION
  && s.normalizationVersion === NORMALIZATION_VERSION
  && s.placeholderVersion === PLACEHOLDER_VERSION;

const sameOrderedTypes = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Score one candidate and decide its tier.
 *
 * Exported and pure so the cascade's judgement can be tested without any database at
 * all — the tier rules are the safety-critical part of this module.
 */
export const evaluateCandidate = (req: TmLookupRequest, segment: TmSegmentRecord): TmMatch => {
  const distance = localeDistance(req.targetLocale, segment.targetLocale);
  const score = scoreMatch(
    tokenizeForCompare(segment.placeholderedSource, segment.placeholderTypes as PlaceholderType[]),
    req.compareTokens,
  );

  const keyEqual = segment.sourceKey === req.sourceKey;
  const approved = segment.status === 'approved';
  const versionsEqual = versionsMatch(segment);
  const kindsEqual = sameOrderedTypes(segment.placeholderTypes, req.placeholderTypes);

  const tier = tierFor(score, {
    keyEqual,
    contextEqual: !!req.contextKey && segment.contextKey === req.contextKey,
    placeholderSafeBoth: segment.placeholderSafe && req.placeholderSafe,
    placeholderKindsEqual: kindsEqual,
    approved,
    versionsEqual,
  });

  const reasons: string[] = [];
  if (!approved) reasons.push('stored segment is ' + segment.status + ', not approved');
  if (!versionsEqual) reasons.push('stored under a different segmentation/normalization version');
  if (!kindsEqual) reasons.push('placeholder type order differs');
  if (!segment.placeholderSafe || !req.placeholderSafe) reasons.push('not placeholder-safe');
  if (score.criticalDiff) reasons.push('a numeral, unit, identifier or chip differs');
  if (score.formatOnly) reasons.push('only inline formatting differs');
  if (distance > 0) reasons.push('came from the ' + segment.targetLocale + ' fallback');
  if (distance < 0) reasons.push('unrelated locale');

  // A fallback-locale hit is never applied automatically: Austrian and German legal
  // wording differ, and the whole point of storing full locales is refusing to
  // pretend otherwise.
  let autoApply = isAutoApplicable(tier) && distance === 0;

  // Regulatory carve-out. The `exact` tier deliberately crosses domains, because
  // cross-category boilerplate is where most of the leverage lives. But "do not immerse
  // in water" means different things in a kettle manual and a pressure-washer manual, and
  // regulation-derived text is exactly where a plausible cross-domain reuse does real
  // damage. So a segment carrying any regulatory reference auto-applies ONLY at perfect
  // (same domain AND same context).
  if (autoApply && segment.regulatoryRefs.length > 0 && tier !== 'exact_in_context') {
    autoApply = false;
    reasons.push('carries a regulatory reference, so it only auto-applies in identical context');
  }

  // Belt and braces against a hash collision: never apply a row whose stored source text
  // does not actually equal what we asked for. This is what lets the key be a fast
  // non-cryptographic hash — a collision degrades to a miss, never to a wrong translation.
  // Checked BEFORE the safety-flag guard below so the reported reason names the real
  // problem rather than a symptom of it.
  if (autoApply && keyEqual && segment.placeholderedSource !== req.placeholderedSource) {
    autoApply = false;
    reasons.push('stored source text does not match despite an equal key');
  }

  // Two segments that agree on their source key must also agree on placeholder safety:
  // an unsafe segment keeps literal values in its pattern text while a safe one carries
  // {{Pn}} markers, so they cannot produce the same key. If they ever do, something about
  // key construction has changed and the two rows are not interchangeable — refuse rather
  // than reason about which one is right.
  if (autoApply && segment.placeholderSafe !== req.placeholderSafe) {
    autoApply = false;
    reasons.push('stored and requested segments disagree on placeholder safety');
  }

  return {
    tier,
    matchPercent: tier === 'none' ? null : score.score,
    segment,
    autoApply,
    referenceOnly: !autoApply && tier !== 'none',
    localeDistance: distance,
    score,
    reason: reasons.join('; '),
  };
};

/** Deterministic pick, so the reuse log is reproducible for the same corpus. */
const bestOf = (matches: TmMatch[]): TmMatch => {
  const rank: Record<MatchTier, number> = {
    exact_in_context: 0,
    exact: 1,
    fuzzy_auto: 2,
    fuzzy_review: 3,
    reference: 4,
    none: 5,
  };
  const usable = matches.filter((m) => m.tier !== 'none');
  if (!usable.length) return MISS;
  return usable.sort(
    (a, b) =>
      rank[a.tier] - rank[b.tier]
      || (b.matchPercent ?? 0) - (a.matchPercent ?? 0)
      || a.localeDistance - b.localeDistance
      || (b.segment?.usageCount ?? 0) - (a.segment?.usageCount ?? 0)
      || (a.segment?.id ?? '').localeCompare(b.segment?.id ?? ''),
  )[0];
};

// ---------------------------------------------------------------------------
// Batched retrieval
// ---------------------------------------------------------------------------

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * Look up a whole run at once.
 *
 * ONE exact query for every request in the run, not one per segment: a mass-translate of
 * a 60-section template into 5 languages is hundreds of segments, and per-segment round
 * trips through PostgREST would dominate the run time. Fuzzy recall is then attempted
 * only for the requests that missed, capped and deduplicated by source text.
 */
export const prefetchTmForRun = async (
  requests: readonly TmLookupRequest[],
): Promise<TmLookupCache> => {
  const results = new Map<string, TmMatch>();
  const stats: Record<string, number> = {
    exact_in_context: 0, exact: 0, fuzzy_auto: 0, fuzzy_review: 0, reference: 0, none: 0,
    applied: 0, reference_only: 0, unavailable: 0,
  };

  const finish = (unavailable: boolean): TmLookupCache => ({
    get: (key: string) => results.get(key) ?? MISS,
    stats,
    unavailable,
  });

  if (!isLive || !requests.length) {
    for (const r of requests) results.set(r.key, MISS);
    stats.none = requests.length;
    return finish(false);
  }

  // --- Stage 1: exact keys, one query -------------------------------------
  const sourceKeys = uniq(requests.map((r) => r.sourceKey));
  const locales = uniq(
    requests.flatMap((r) => localeFallbackChain(r.targetLocale)),
  );

  let exactRows: Row[] = [];
  let failed = false;
  try {
    exactRows = await db.select<Row>('im_tm_segments', {
      where: {
        source_key: sourceKeys,
        target_locale: locales,
        status: ['approved', 'unreviewed'],
      },
    });
  } catch (e) {
    failed = true;
    console.warn('[im-tm-lookup] exact stage failed; treating the run as a full miss.', e);
  }

  const byKey = new Map<string, TmSegmentRecord[]>();
  for (const row of exactRows) {
    const rec = mapTmSegmentRow(row);
    const list = byKey.get(rec.sourceKey) ?? [];
    list.push(rec);
    byKey.set(rec.sourceKey, list);
  }

  const missed: TmLookupRequest[] = [];
  for (const req of requests) {
    const chain = localeFallbackChain(req.targetLocale);
    const candidates = (byKey.get(req.sourceKey) ?? []).filter((s) =>
      chain.includes(normalizeLocale(s.targetLocale)),
    );
    const best = bestOf(candidates.map((s) => evaluateCandidate(req, s)));
    if (best.tier === 'none') {
      missed.push(req);
      continue;
    }
    results.set(req.key, best);
  }

  // --- Stage 2: fuzzy recall for what missed -------------------------------
  //
  // Deduplicated by (source text, target locale) because trigram matching is per-string,
  // and capped so a first run against an empty memory cannot issue thousands of calls.
  const fuzzyGroups = new Map<string, TmLookupRequest[]>();
  for (const req of failed ? [] : missed) {
    // If the exact stage could not read the table there is no reason to believe the
    // fuzzy RPC will fare better; skipping it keeps a database outage from turning one
    // failed query into hundreds.
    if (req.placeholderedSource.length < MIN_FUZZY_CHARS) continue;
    const groupKey = normalizeLocale(req.targetLocale) + '\n' + req.placeholderedSource;
    const group = fuzzyGroups.get(groupKey) ?? [];
    group.push(req);
    fuzzyGroups.set(groupKey, group);
  }

  let fuzzyCalls = 0;
  let skippedForCap = 0;
  for (const group of fuzzyGroups.values()) {
    if (fuzzyCalls >= MAX_FUZZY_CALLS) {
      skippedForCap += group.length;
      continue;
    }
    fuzzyCalls++;
    const req = group[0];
    const rows = await orEmpty(
      db.rpc<Row[]>('im_tm_fuzzy_candidates', {
        p_source: req.placeholderedSource,
        p_source_locale: req.sourceLocale,
        p_target_locales: localeFallbackChain(req.targetLocale),
        p_min_similarity: 0.45,
        p_limit: 30,
        p_domain_category: req.domainCategoryId ?? null,
      }),
      '[im-tm-lookup] fuzzy candidates',
    );
    const records = rows.map(mapTmSegmentRow);
    for (const member of group) {
      const scored = records
        .filter((s) => prefilterPass(
          tokenizeForCompare(s.placeholderedSource, s.placeholderTypes as PlaceholderType[]),
          member.compareTokens,
          TM_CANDIDATE_MIN,
        ))
        .map((s) => evaluateCandidate(member, s));
      const best = bestOf(scored);
      if (best.tier !== 'none') results.set(member.key, best);
    }
  }

  if (skippedForCap > 0) {
    // Never let a bounded search look like exhaustive coverage.
    console.warn(
      '[im-tm-lookup] fuzzy stage capped at ' + MAX_FUZZY_CALLS + ' lookups; '
      + skippedForCap + ' segment(s) were treated as misses without a fuzzy search.',
    );
  }

  for (const req of requests) {
    const match = results.get(req.key);
    if (!match) {
      results.set(req.key, MISS);
      stats.none++;
      continue;
    }
    stats[match.tier] = (stats[match.tier] ?? 0) + 1;
    if (match.autoApply) stats.applied++;
    else if (match.referenceOnly) stats.reference_only++;
  }
  if (failed) stats.unavailable = requests.length;

  return finish(failed);
};

/** Single-segment convenience wrapper. Prefer `prefetchTmForRun` for anything batched. */
export const lookupTmSegment = async (req: TmLookupRequest): Promise<TmMatch> =>
  (await prefetchTmForRun([req])).get(req.key);

/**
 * Raw fuzzy candidates for one segment, for an author-facing "have we written something
 * like this before?" panel. Scored and tiered, never auto-applied by the caller.
 */
export const fetchTmCandidates = async (
  req: TmLookupRequest,
  opts: { limit?: number; minSimilarity?: number } = {},
): Promise<TmMatch[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.rpc<Row[]>('im_tm_fuzzy_candidates', {
      p_source: req.placeholderedSource,
      p_source_locale: req.sourceLocale,
      p_target_locales: localeFallbackChain(req.targetLocale),
      p_min_similarity: opts.minSimilarity ?? 0.35,
      p_limit: opts.limit ?? 20,
      p_domain_category: req.domainCategoryId ?? null,
    }),
    '[im-tm-lookup] candidates',
  );
  return rows
    .map(mapTmSegmentRow)
    .map((s) => evaluateCandidate(req, s))
    .filter((m) => m.tier !== 'none' && (m.matchPercent ?? 0) >= TM_SUGGEST_MIN)
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0));
};
