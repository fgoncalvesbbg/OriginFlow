/**
 * The public seam of the translation-memory core.
 *
 * Everything above this line — retrieval, persistence, the XLIFF paths, the UI —
 * only ever needs two functions: `buildTmSourceUnits` to turn a fragment into
 * lookup/storage rows, and `reassembleFragment` (im-tm-reassemble.ts) to turn
 * translated rows back into fragment HTML. Keeping the surface that narrow is what
 * allows the segmentation, normalization and placeholder rules to be versioned and
 * changed without touching a single caller.
 *
 * Fully synchronous and pure: no I/O, no `crypto.subtle`, no DOM. It runs in the
 * browser, in Node under vitest, and inside a Netlify function unchanged.
 *
 * THE ENGINE-CALL CONTRACT, which lives here because it is easy to get wrong
 * -------------------------------------------------------------------------
 * For a segment that MISSES the memory, the caller must:
 *
 *   1. Build `freezeVerbatims({ text: segment.rawText, frozen: sf.frozen }, entries)`
 *      at engine-call time ONLY, and send its `text`.
 *   2. Validate the `countTokens` round-trip on the response, exactly as
 *      translateHtml already does.
 *   3. `thaw` with the returned (extended) frozen array.
 *   4. Convert the result back into `{{Tn:identity}}` marker form before handing it
 *      to `reassembleFragment`.
 *
 * Verbatim freezing must happen INSIDE that call and die there. `freezeVerbatims`
 * bakes the TARGET language's approved wording into the frozen array, so a verbatim
 * token that reached a key would make the source hash vary per target language and
 * destroy the corpus's whole premise. Order is therefore fixed and non-negotiable:
 *
 *   freeze -> segment -> normalize -> placeholder -> key -> LOOKUP
 *          -> (misses only) freezeVerbatims -> engine -> re-inject -> reassemble -> thaw
 */

import { normalizeForMatch } from './im-tm-normalize';
import { extractPlaceholders } from './im-tm-placeholders';
import { segmentFragment } from './im-tm-segment';
import { buildSegmentKeys, protectedPhrasesDigest } from './im-tm-key';
import { tokenizeForCompare } from './im-tm-similarity';
import type {
  CompareToken,
  ExtractedPlaceholder,
  FragmentIneligibleReason,
  PlaceholderedSegment,
  Segment,
  SegmentAnchor,
  SegmentKeys,
  SegmentedFragment,
} from './im-tm-types';

export interface TmSourceUnit {
  anchor: SegmentAnchor;
  segment: Segment;
  /** Canonical matching form of the segment's key text, before placeholdering. */
  normalized: string;
  placeholdered: PlaceholderedSegment;
  keys: SegmentKeys;
  /** Precomputed so the retrieval layer can rescore candidates without re-tokenizing. */
  compareTokens: CompareToken[];
  /**
   * False when the unit is not worth a TM row at all — a data-only table cell, or a
   * run that placeholdering reduced to nothing but markers.
   */
  translatable: boolean;
}

export interface BuildTmSourceUnitsOptions {
  /** Full locale code of the source, e.g. `en`. */
  sourceLocale: string;
  /** Mandated regulation wording that a sentence boundary must not cut through. */
  protectedPhrases?: string[];
  /** Brand and product names to protect, from product data. Never guessed. */
  brands?: string[];
}

export interface TmSourceUnitsResult {
  segmented: SegmentedFragment;
  units: TmSourceUnit[];
  /** Set when the fragment cannot participate; the caller falls back to whole-fragment translation. */
  ineligibleReason?: FragmentIneligibleReason;
  /** Ready to hand straight to `reassembleFragment`. */
  placeholdersBySegment: Record<number, ExtractedPlaceholder[]>;
}

/**
 * Decompose one fragment into translation-memory units.
 *
 * Never throws. An unparseable or pathological fragment comes back with
 * `ineligibleReason` set and zero units, and its `segmented` still reassembles to
 * the original HTML byte-for-byte.
 */
export const buildTmSourceUnits = (
  fragmentId: string,
  sourceHtml: string,
  opts: BuildTmSourceUnitsOptions,
): TmSourceUnitsResult => {
  const sourceLocale = opts.sourceLocale || 'en';
  const protectedPhrases = opts.protectedPhrases ?? [];

  const segmented = segmentFragment(sourceHtml, {
    // The abbreviation lists are keyed by language, not locale.
    sourceLang: sourceLocale.split('-')[0],
    protectedPhrases,
  });

  if (segmented.ineligibleReason || !segmented.segments.length) {
    return {
      segmented,
      units: [],
      ineligibleReason: segmented.ineligibleReason,
      placeholdersBySegment: {},
    };
  }

  // Pass 1: normalize and placeholder every segment, because a segment's context
  // hash needs its NEIGHBOURS' pattern text.
  const normalized = segmented.segments.map((s) => normalizeForMatch(s.keyText));
  const placeholdered = normalized.map((n) => extractPlaceholders(n, { brands: opts.brands }));

  // The digest only enters the key when the phrase list actually changed this
  // fragment's boundaries — otherwise editing an unrelated verbatim would churn
  // every key in the corpus.
  const digest = segmented.protectedCutSuppressed
    ? protectedPhrasesDigest(protectedPhrases)
    : undefined;

  const placeholdersBySegment: Record<number, ExtractedPlaceholder[]> = {};

  const units: TmSourceUnit[] = segmented.segments.map((segment, i) => {
    const ph = placeholdered[i];
    const keys = buildSegmentKeys(
      {
        patternText: ph.patternText,
        placeholders: ph.placeholders,
        container: segment.container,
        rawText: segment.rawText,
      },
      {
        before: i > 0 ? placeholdered[i - 1].patternText : '',
        after: i < placeholdered.length - 1 ? placeholdered[i + 1].patternText : '',
      },
      { sourceLocale, protectedPhrasesDigest: digest },
    );

    placeholdersBySegment[segment.index] = ph.placeholders;

    return {
      anchor: {
        fragmentId,
        index: segment.index,
        structuralPath: segment.anchorPath,
        container: segment.container,
      },
      segment,
      normalized: normalized[i],
      placeholdered: ph,
      keys,
      compareTokens: tokenizeForCompare(ph.patternText, ph.placeholders.map((p) => p.type)),
      translatable: ph.translatable,
    };
  });

  return { segmented, units, placeholdersBySegment };
};

/** The units actually worth storing and looking up. */
export const translatableUnits = (result: TmSourceUnitsResult): TmSourceUnit[] =>
  result.units.filter((u) => u.translatable);
