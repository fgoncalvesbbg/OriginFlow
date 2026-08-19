/**
 * Orchestration seam between the translation-memory core and the two translation
 * paths that consume it.
 *
 * Both the in-app AI translate flow and the XLIFF vendor export need to answer the
 * same question about a fragment: "how much of this do we already have, and what is
 * the assembled target for the part we do?" Answering it in one place is what keeps
 * the two paths from drifting into different reuse rules — which would show up as a
 * vendor being billed for text the app would have reused, or worse, as the two paths
 * applying different safety gates to the same content.
 *
 * WHAT IT DOES NOT DO: it never calls the translation engine and never writes
 * anything. It reads the memory and reports a plan. The caller decides what to send
 * to a model, what to hand a vendor, and what to write back — because those are the
 * steps with cost and side effects, and they belong where the run report and the
 * progress UI already live.
 *
 * SOURCE UNITS ARE BUILT ONCE PER FRAGMENT, not once per fragment-and-locale. The
 * source text is identical across target languages, and segmentation plus
 * placeholder extraction is the expensive part; a 60-section template into 5
 * languages would otherwise redo the same work five times.
 */

import { DEFAULT_SOURCE_LOCALE, normalizeLocale } from '../../config/im-locales';
import { getTranslationVerbatims } from '../ai/translation-verbatim.service';
import { alignTargetToSource, type AlignmentRejection } from './im-tm-align';
import { buildTmSourceUnits, type TmSourceUnit } from './im-tm-core';
import { prefetchTmForRun, type TmLookupRequest, type TmMatch } from './im-tm-lookup.service';
import { reassembleFragment } from './im-tm-reassemble';
import {
  recordTmSegments,
  reuseTierFor,
  type RecordTmSegmentInput,
  type TmReuseEvent,
  type TmRunKind,
} from './im-tm-write.service';
import type {
  ExtractedPlaceholder,
  FragmentIneligibleReason,
  SegmentedFragment,
  TranslatedSegment,
} from './im-tm-types';

/** One fragment to consider, as `collectTranslationFragments` produces them. */
export interface TmPlanFragment {
  id: string;
  sourceHtml: string;
  /** Human breadcrumb, carried through so the caller's report can name the fragment. */
  label?: string;
}

export interface TmPlanContext {
  sourceLocale?: string;
  /** Mandated regulation wording a sentence boundary must not cut through. */
  protectedPhrases?: string[];
  /** Brand and product names to protect. Never guessed — supply them or get none. */
  brands?: string[];
  domainCategoryId?: string | null;
  domainContentType?: string | null;
  /** Run identity, for the reuse log the caller will write. */
  runId: string;
  runKind: TmRunKind;
  scope: 'template' | 'block' | 'project';
  templateId?: string | null;
  blockId?: string | null;
  projectId?: string | null;
  templateType?: string | null;
}

/** What the memory can contribute to one fragment in one target language. */
export interface TmFragmentPlan {
  fragmentId: string;
  targetLocale: string;
  /**
   * True when every translatable segment resolved to an approved auto-applicable
   * match, so `html` is a complete translation and no engine call is needed.
   */
  fullyCovered: boolean;
  /** The assembled target HTML. Non-null only when `fullyCovered`. */
  html: string | null;
  /** Segments the memory could not supply — these need the engine. */
  misses: TmSourceUnit[];
  /**
   * Near-matches for the missing segments, to hand the engine as minimal-edit
   * references. Keyed by segment index.
   */
  references: Map<number, TmMatch>;
  /** Every segment's outcome, for the run report and the reuse log. */
  outcomes: Array<{ unit: TmSourceUnit; match: TmMatch }>;
  /** Ids of the memory rows actually applied, for the usage counters. */
  appliedSegmentIds: string[];
  /**
   * A complete but NOT auto-applicable rendering of the fragment, assembled from the
   * best available match for every translatable segment — including unreviewed and
   * near-matches. Non-null only when every segment had something.
   *
   * This is what a vendor's CAT tool is shown as a suggestion, and what the engine can
   * be given as a minimal-edit reference. It must never be written into content: by
   * construction it contains material that failed at least one safety gate.
   */
  referenceHtml: string | null;
  /** Lowest match percentage among the segments used to build `referenceHtml`. */
  referenceQuality: number | null;
  reuseEvents: TmReuseEvent[];
  ineligibleReason?: FragmentIneligibleReason;
}

/** Everything the caller needs to act, plus what it needs to reassemble later. */
export interface TmPlanResult {
  /** Keyed `${fragmentId}::${targetLocale}`. */
  plans: Map<string, TmFragmentPlan>;
  /** The segmented source of each fragment, for reassembly after the engine runs. */
  segmented: Map<string, SegmentedFragment>;
  /** Translatable source units per fragment, so write-back never re-segments. */
  units: Map<string, TmSourceUnit[]>;
  /** Placeholder values per fragment, for reassembly. */
  placeholders: Map<string, Record<number, ExtractedPlaceholder[]>>;
  /** True when the memory could not be read at all and every plan is a forced miss. */
  memoryUnavailable: boolean;
  /** Tier counts across the whole run, for the report. */
  stats: Record<string, number>;
}

export const planKey = (fragmentId: string, targetLocale: string): string =>
  fragmentId + '::' + normalizeLocale(targetLocale);

/**
 * The mandated-phrase list, cached for the session.
 *
 * EVERY path that plans a translation must pass the SAME list. Protected phrases can
 * suppress a sentence boundary, so two callers using different lists would segment the
 * same fragment differently, produce different keys, and share no memory at all — the
 * failure would look like "the memory just never hits" rather than like a bug.
 *
 * Degrades to an empty list on failure rather than throwing: no protected phrases means
 * slightly more aggressive segmentation, not incorrect output, and the verbatim
 * protection itself is enforced separately at engine-call and publish time.
 */
let protectedPhrasesPromise: Promise<string[]> | null = null;
export const getProtectedPhrases = (): Promise<string[]> => {
  if (!protectedPhrasesPromise) {
    protectedPhrasesPromise = getTranslationVerbatims()
      .then((vs) => vs.map((v) => v.phrase).filter((p) => p && p.trim()))
      .catch((e) => {
        console.warn('[im-tm-translate] could not load protected phrases; continuing without.', e);
        return [];
      });
  }
  return protectedPhrasesPromise;
};

/** Test seam: forget the cached phrase list. */
export const resetProtectedPhrasesCache = (): void => {
  protectedPhrasesPromise = null;
};

const requestKey = (fragmentId: string, segmentIndex: number, targetLocale: string): string =>
  fragmentId + '#' + segmentIndex + '#' + normalizeLocale(targetLocale);

/**
 * Read the memory for every (fragment, target locale, segment) in a run and report what
 * it can supply.
 *
 * Never throws: a memory outage comes back as `memoryUnavailable` with every plan a
 * full miss, so the caller translates everything exactly as it does today.
 */
export const planTmTranslation = async (
  fragments: readonly TmPlanFragment[],
  targetLocales: readonly string[],
  ctx: TmPlanContext,
): Promise<TmPlanResult> => {
  const sourceLocale = normalizeLocale(ctx.sourceLocale ?? DEFAULT_SOURCE_LOCALE);
  const locales = [...new Set(targetLocales.map(normalizeLocale))];

  const segmented = new Map<string, SegmentedFragment>();
  const placeholders = new Map<string, Record<number, ExtractedPlaceholder[]>>();
  const unitsByFragment = new Map<string, TmSourceUnit[]>();
  const ineligible = new Map<string, FragmentIneligibleReason | undefined>();

  // Pass 1: decompose each fragment ONCE, regardless of how many target languages.
  for (const fragment of fragments) {
    const built = buildTmSourceUnits(fragment.id, fragment.sourceHtml, {
      sourceLocale,
      protectedPhrases: ctx.protectedPhrases,
      brands: ctx.brands,
    });
    segmented.set(fragment.id, built.segmented);
    placeholders.set(fragment.id, built.placeholdersBySegment);
    unitsByFragment.set(fragment.id, built.units);
    ineligible.set(fragment.id, built.ineligibleReason);
  }

  // Pass 2: one lookup request per (fragment, locale, translatable segment).
  const requests: TmLookupRequest[] = [];
  for (const fragment of fragments) {
    for (const unit of unitsByFragment.get(fragment.id) ?? []) {
      if (!unit.translatable) continue;
      for (const targetLocale of locales) {
        requests.push({
          key: requestKey(fragment.id, unit.segment.index, targetLocale),
          sourceLocale,
          targetLocale,
          sourceKey: unit.keys.segmentKey,
          plainKey: unit.keys.plainKeyHash,
          contextKey: unit.keys.contextHash,
          placeholderedSource: unit.placeholdered.patternText,
          placeholderTypes: unit.placeholdered.placeholders.map((p) => p.type),
          placeholderSafe: unit.placeholdered.placeholderSafe,
          domainCategoryId: ctx.domainCategoryId ?? null,
          domainContentType: ctx.domainContentType ?? null,
          compareTokens: unit.compareTokens,
        });
      }
    }
  }

  const cache = await prefetchTmForRun(requests);

  // Pass 3: turn matches into a per-(fragment, locale) plan.
  const plans = new Map<string, TmFragmentPlan>();

  for (const fragment of fragments) {
    const units = unitsByFragment.get(fragment.id) ?? [];
    const sf = segmented.get(fragment.id)!;
    const phByIndex = placeholders.get(fragment.id) ?? {};

    for (const targetLocale of locales) {
      const outcomes: Array<{ unit: TmSourceUnit; match: TmMatch }> = [];
      const misses: TmSourceUnit[] = [];
      const references = new Map<number, TmMatch>();
      const appliedSegmentIds: string[] = [];
      const reuseEvents: TmReuseEvent[] = [];
      const translated: TranslatedSegment[] = [];

      for (const unit of units) {
        if (!unit.translatable) continue;
        const match = cache.get(requestKey(fragment.id, unit.segment.index, targetLocale));
        outcomes.push({ unit, match });

        if (match.autoApply && match.segment) {
          translated.push({
            segmentIndex: unit.segment.index,
            targetKeyText: match.segment.targetText,
            origin: match.tier === 'fuzzy_auto' ? 'tm_fuzzy' : 'tm_exact',
          });
          appliedSegmentIds.push(match.segment.id);
        } else {
          misses.push(unit);
          if (match.referenceOnly && match.segment) references.set(unit.segment.index, match);
        }

        reuseEvents.push({
          runId: ctx.runId,
          runKind: ctx.runKind,
          scope: ctx.scope,
          templateId: ctx.templateId ?? null,
          blockId: ctx.blockId ?? null,
          projectId: ctx.projectId ?? null,
          templateType: ctx.templateType ?? null,
          fragmentId: fragment.id,
          segmentIndex: unit.segment.index,
          sourceLocale,
          targetLocale,
          tier: reuseTierFor(match.tier),
          matchPercent: match.matchPercent,
          localeDistance: match.localeDistance < 0 ? 0 : match.localeDistance,
          matchedSegmentId: match.segment?.id ?? null,
          applied: match.autoApply,
          referenceOnly: match.referenceOnly,
          domainCategoryId: ctx.domainCategoryId ?? null,
          domainContentType: ctx.domainContentType ?? null,
          sourceChars: unit.segment.rawText.length,
        });
      }

      const translatableCount = units.filter((u) => u.translatable).length;
      const fullyCovered =
        !ineligible.get(fragment.id) && translatableCount > 0 && misses.length === 0;

      let html: string | null = null;
      if (fullyCovered) {
        const out = reassembleFragment(sf, translated, {
          targetLang: targetLocale,
          placeholdersBySegment: phByIndex,
        });
        // A reassembly that failed any integrity gate is NOT a translation. Fall back to
        // treating the whole fragment as a miss rather than persisting suspect output —
        // the same contract translateHtml enforces when it refuses a bad model response.
        if (out.ok && out.perSegment.every((p) => p.applied)) {
          html = out.html;
        }
      }

      // A suggestion covering the WHOLE fragment, usable only when every translatable
      // segment had some match. Built through the same reassembly gates as a real
      // translation so a vendor is never shown output that could not be assembled.
      let referenceHtml: string | null = null;
      let referenceQuality: number | null = null;
      const everySegmentHasSomething =
        !ineligible.get(fragment.id)
        && translatableCount > 0
        && outcomes.every((o) => o.match.segment !== null);
      if (everySegmentHasSomething) {
        const suggestion: TranslatedSegment[] = outcomes.map((o) => ({
          segmentIndex: o.unit.segment.index,
          targetKeyText: o.match.segment!.targetText,
          origin: o.match.autoApply ? 'tm_exact' : 'tm_fuzzy',
        }));
        const out = reassembleFragment(sf, suggestion, {
          targetLang: targetLocale,
          placeholdersBySegment: phByIndex,
        });
        if (out.ok && out.perSegment.every((p) => p.applied)) {
          referenceHtml = out.html;
          referenceQuality = Math.min(...outcomes.map((o) => o.match.matchPercent ?? 0));
        }
      }

      plans.set(planKey(fragment.id, targetLocale), {
        fragmentId: fragment.id,
        targetLocale: normalizeLocale(targetLocale),
        fullyCovered: html !== null,
        html,
        misses: html !== null ? [] : units.filter((u) => u.translatable),
        references,
        outcomes,
        appliedSegmentIds: html !== null ? appliedSegmentIds : [],
        referenceHtml,
        referenceQuality,
        reuseEvents,
        ineligibleReason: ineligible.get(fragment.id),
      });
    }
  }

  const translatableUnitsByFragment = new Map<string, TmSourceUnit[]>();
  for (const [id, us] of unitsByFragment) {
    translatableUnitsByFragment.set(id, us.filter((u) => u.translatable));
  }

  return {
    plans,
    segmented,
    units: translatableUnitsByFragment,
    placeholders,
    memoryUnavailable: cache.unavailable,
    stats: cache.stats,
  };
};

export interface TmTranslateFragmentResult {
  html: string;
  /** True when the memory supplied the whole fragment and NO engine call was made. */
  fromMemory: boolean;
  /** Rows to write back, empty when alignment refused or the memory already had it. */
  writeBack: RecordTmSegmentInput[];
  /** Why nothing was written back, when alignment refused. */
  alignmentRejection?: AlignmentRejection;
  /**
   * The reuse decisions for THIS fragment and locale only.
   *
   * Returned per call rather than harvested from the whole plan on purpose: a run
   * typically plans more (fragment, locale) pairs than it processes, because
   * "skip already-translated" filters some out afterwards. Logging the plan wholesale
   * would credit the memory with decisions on work that never happened and make the
   * leverage report overstate itself.
   */
  reuseEvents: TmReuseEvent[];
  /** Memory rows actually applied, for the usage counters. */
  appliedSegmentIds: string[];
}

/**
 * Translate one fragment, using the memory where it can and the engine where it must.
 *
 * The engine call is injected rather than imported so this stays testable without
 * network or model mocks, and so the caller keeps ownership of retries, progress and
 * the run report — all of which already live in the page.
 *
 * Write-back is `origin: 'machine'` and therefore lands as `unreviewed`: nothing here
 * can ever produce content the memory will auto-apply. That only happens after a human
 * approves it.
 */
export const translateFragmentWithMemory = async (
  fragmentId: string,
  sourceHtml: string,
  targetLocale: string,
  plan: TmPlanResult,
  ctx: TmPlanContext,
  translate: (html: string) => Promise<string>,
): Promise<TmTranslateFragmentResult> => {
  const locale = normalizeLocale(targetLocale);
  const entry = plan.plans.get(planKey(fragmentId, locale));
  const reuseEvents = entry?.reuseEvents ?? [];

  // The memory covered it outright — no engine call, nothing new to remember.
  if (entry?.fullyCovered && entry.html) {
    return {
      html: entry.html,
      fromMemory: true,
      writeBack: [],
      reuseEvents,
      appliedSegmentIds: entry.appliedSegmentIds,
    };
  }

  const html = await translate(sourceHtml);

  const units = plan.units.get(fragmentId) ?? [];
  const segmented = plan.segmented.get(fragmentId);
  if (!units.length || !segmented) {
    return { html, fromMemory: false, writeBack: [], reuseEvents, appliedSegmentIds: [] };
  }

  const alignment = alignTargetToSource(units, segmented, html, {
    targetLocale: locale,
    protectedPhrases: ctx.protectedPhrases,
  });
  if (!alignment.aligned.length) {
    return {
      html,
      fromMemory: false,
      writeBack: [],
      alignmentRejection: alignment.rejection,
      reuseEvents,
      appliedSegmentIds: [],
    };
  }

  const sourceLocale = normalizeLocale(ctx.sourceLocale ?? DEFAULT_SOURCE_LOCALE);
  const writeBack: RecordTmSegmentInput[] = alignment.aligned.map(({ unit, targetText }) => ({
    sourceLocale,
    targetLocale: locale,
    sourceKey: unit.keys.segmentKey,
    plainKey: unit.keys.plainKeyHash,
    contextKey: unit.keys.contextHash,
    sourceFingerprint: unit.keys.sourceFingerprint,
    placeholderedSource: unit.placeholdered.patternText,
    rawSource: unit.segment.rawText,
    targetText,
    placeholderTypes: unit.placeholdered.placeholders.map((p) => p.type),
    tokenIdentities: unit.segment.tokens.map((t) => t.identity),
    placeholderSafe: unit.placeholdered.placeholderSafe,
    container: unit.segment.container,
    anchorPath: unit.segment.anchorPath,
    domainCategoryId: ctx.domainCategoryId ?? null,
    domainContentType: ctx.domainContentType ?? null,
    // Derived here, never taken from a caller: machine output must not be able to
    // present itself as human-reviewed translation.
    origin: 'machine',
  }));

  return { html, fromMemory: false, writeBack, reuseEvents, appliedSegmentIds: [] };
};

export interface ImportedTranslation {
  fragmentId: string;
  /** The English source as it stands in the template now. */
  sourceHtml: string;
  targetLocale: string;
  /** The translation that was just applied. */
  targetHtml: string;
}

export interface RecordImportedResult {
  /** Rows offered to the memory. */
  attempted: number;
  /** Fragments whose translation could not be aligned segment-for-segment. */
  rejected: number;
  rejections: Array<{ fragmentId: string; targetLocale: string; reason: AlignmentRejection }>;
}

/**
 * Remember translations that arrived from an external vendor.
 *
 * Without this, a vendor's work never enters the memory and the same boilerplate is
 * bought again on the next product — which is most of the cost this feature exists to
 * remove.
 *
 * Stored as `origin: 'imported'` and therefore `unreviewed`: a vendor translation is
 * not automatically authoritative, and cannot be auto-applied until somebody approves
 * it. `sourceRef` records which file it came from, so an unreliable supplier's whole
 * contribution can be retired in one action later.
 *
 * The caller supplies only translations it actually APPLIED — recording something that
 * was rejected on import would put content in the memory that is not in the template.
 */
export const recordImportedTranslations = async (
  entries: readonly ImportedTranslation[],
  ctx: TmPlanContext & { sourceRef?: string | null },
): Promise<RecordImportedResult> => {
  const summary: RecordImportedResult = { attempted: 0, rejected: 0, rejections: [] };
  if (!entries.length) return summary;

  const sourceLocale = normalizeLocale(ctx.sourceLocale ?? DEFAULT_SOURCE_LOCALE);
  const rows: RecordTmSegmentInput[] = [];

  // Segment each distinct source fragment once, however many locales it arrived in.
  const builtCache = new Map<string, ReturnType<typeof buildTmSourceUnits>>();
  const buildFor = (entry: ImportedTranslation) => {
    const cached = builtCache.get(entry.fragmentId);
    if (cached) return cached;
    const built = buildTmSourceUnits(entry.fragmentId, entry.sourceHtml, {
      sourceLocale,
      protectedPhrases: ctx.protectedPhrases,
      brands: ctx.brands,
    });
    builtCache.set(entry.fragmentId, built);
    return built;
  };

  for (const entry of entries) {
    const built = buildFor(entry);
    const units = built.units.filter((u) => u.translatable);
    if (!units.length) continue;

    const locale = normalizeLocale(entry.targetLocale);
    const alignment = alignTargetToSource(units, built.segmented, entry.targetHtml, {
      targetLocale: locale,
      protectedPhrases: ctx.protectedPhrases,
    });
    if (!alignment.aligned.length) {
      summary.rejected++;
      if (alignment.rejection) {
        summary.rejections.push({
          fragmentId: entry.fragmentId,
          targetLocale: locale,
          reason: alignment.rejection,
        });
      }
      continue;
    }

    for (const { unit, targetText } of alignment.aligned) {
      rows.push({
        sourceLocale,
        targetLocale: locale,
        sourceKey: unit.keys.segmentKey,
        plainKey: unit.keys.plainKeyHash,
        contextKey: unit.keys.contextHash,
        sourceFingerprint: unit.keys.sourceFingerprint,
        placeholderedSource: unit.placeholdered.patternText,
        rawSource: unit.segment.rawText,
        targetText,
        placeholderTypes: unit.placeholdered.placeholders.map((p) => p.type),
        tokenIdentities: unit.segment.tokens.map((t) => t.identity),
        placeholderSafe: unit.placeholdered.placeholderSafe,
        container: unit.segment.container,
        anchorPath: unit.segment.anchorPath,
        domainCategoryId: ctx.domainCategoryId ?? null,
        domainContentType: ctx.domainContentType ?? null,
        origin: 'imported',
        sourceRef: ctx.sourceRef ?? null,
      });
    }
  }

  summary.attempted = rows.length;
  if (rows.length) await recordTmSegments(rows);
  return summary;
};

/** Every reuse event across a plan result, ready for `logTmReuse`. */
export const reuseEventsOf = (result: TmPlanResult): TmReuseEvent[] =>
  [...result.plans.values()].flatMap((p) => p.reuseEvents);

/** Every memory row that was actually applied, ready for `noteTmSegmentsUsed`. */
export const appliedSegmentIdsOf = (result: TmPlanResult): string[] =>
  [...new Set([...result.plans.values()].flatMap((p) => p.appliedSegmentIds))];

/**
 * Per-locale counts for a run report: how many fragments the memory covered outright,
 * how many carry a usable reference, and how many are entirely new.
 *
 * Reported per tier rather than as one blended percentage, because "we reused 62%"
 * hides whether that was safe exact matches or near-matches somebody had to check.
 */
export interface TmCoverageSummary {
  prefilled: number;
  withReference: number;
  fresh: number;
}

export const summarizeCoverage = (
  result: TmPlanResult,
  targetLocale: string,
): TmCoverageSummary => {
  const summary: TmCoverageSummary = { prefilled: 0, withReference: 0, fresh: 0 };
  const wanted = normalizeLocale(targetLocale);
  for (const plan of result.plans.values()) {
    if (plan.targetLocale !== wanted) continue;
    if (plan.fullyCovered) summary.prefilled++;
    else if (plan.referenceHtml || plan.references.size > 0) summary.withReference++;
    else summary.fresh++;
  }
  return summary;
};
