/**
 * Translation-memory keys for one segment.
 *
 * Three separate keys, because they answer three different questions:
 *
 *  - `segmentKey` — "is this the same source sentence?" The exact-match key.
 *    Placeholder VALUES are deliberately absent (that is the whole point of
 *    placeholdering) but their ORDERED TYPES are present, so a `{{P0}}` that came
 *    from a measurement can never collide with one that came from an article code.
 *
 *  - `plainKeyHash` — the same thing with inline formatting markers removed.
 *    FUZZY RECALL ONLY. "Fill to the <strong>MAX</strong> line." and "Fill to the
 *    MAX line." are separate TM entries on purpose: target word order makes
 *    re-deriving tag positions impossible, so lending one target to the other
 *    source would silently drop or add emphasis in a regulated instruction. This
 *    key exists to FIND that near-match and show it to a human, never to apply it.
 *
 *  - `contextHash` — "does it sit in the same surroundings?" Separates the source
 *    spec's "perfect" tier (safe to apply unreviewed) from plain "exact" (apply
 *    but spot-check). Fragment-scoped: `before`/`after` are the neighbouring
 *    segments of the same fragment, because an inline block IS the paragraph-level
 *    context a translator needs, and reaching further would make every context
 *    hash churn whenever an unrelated row moved. The failure mode is benign — a
 *    stale context downgrades a tier, it never produces a wrong reuse.
 *
 * `sourceFingerprint` is a plain byte-level hash of the raw segment, used for
 * staleness and duplicate detection rather than for matching.
 *
 * All four are versioned through the constants below plus the segmentation,
 * normalization and placeholder versions. Retrieval must refuse hash-equality
 * tiers when a stored row's versions differ from the current ones, so a forgotten
 * version bump degrades to cache misses instead of to wrong reuse.
 */

import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';
import { tmHash128, tmHashFields } from './im-tm-hash';
import type { ExtractedPlaceholder, KeyContext, SegmentKeys } from './im-tm-types';

export const KEY_FORMAT_VERSION = 1;
export const CONTEXT_VERSION = 1;

/** Sentinels for the first and last segment of a fragment, so "no neighbour" is explicit. */
const BOF = String.fromCharCode(2) + 'BOF';
const EOF = String.fromCharCode(3) + 'EOF';

/** Inline-formatting and line-break markers — everything except chips and images. */
const FORMAT_MARKER_RE = /\{\{T\d+:(?:o\.[A-Za-z0-9_.-]+|c\.[A-Za-z0-9_.-]+|br)\}\}/g;

/** Strip inline formatting, leaving prose, chips and images. Used for `plainKeyHash` only. */
export const stripFormatMarkers = (s: string): string =>
  s.replace(FORMAT_MARKER_RE, '').replace(/ {2,}/g, ' ').trim();

export interface KeyableUnit {
  /** Normalized, placeholdered matching form — the thing that actually gets hashed. */
  patternText: string;
  /** Ordered placeholders; only their types enter the key. */
  placeholders: ExtractedPlaceholder[];
  /** `p` | `td` | `root` ... — mixed into the context hash so a cell and a paragraph differ. */
  container: string;
  /** Verbatim frozen slice, for the byte-level fingerprint. */
  rawText: string;
}

export interface BuildKeyOptions {
  /** Full locale code of the source, e.g. `en` or `en-GB`. */
  sourceLocale: string;
  /**
   * Digest of the protected-phrase list, supplied ONLY when the phrase list
   * actually changed this fragment's segmentation.
   *
   * Segmentation depends on mutable database rows (`translation_verbatims`), which
   * would otherwise make every key in the corpus churn whenever a phrase is
   * edited. Mixing the digest in only for the fragments a phrase genuinely
   * affected keeps the other 99% stable.
   */
  protectedPhrasesDigest?: string;
}

/** Stable digest of a protected-phrase list — order-insensitive, so admin reordering is a no-op. */
export const protectedPhrasesDigest = (phrases: string[]): string =>
  tmHash128([...phrases].filter((p) => p && p.trim()).sort().join(String.fromCharCode(31)));

export const buildSegmentKeys = (
  unit: KeyableUnit,
  ctx: KeyContext,
  opts: BuildKeyOptions,
): SegmentKeys => {
  const locale = (opts.sourceLocale || 'en').toLowerCase();
  const typeSignature = unit.placeholders.map((p) => p.type).join(',');
  const digest = opts.protectedPhrasesDigest ?? '';

  const segmentKey = tmHashFields([
    'sk' + KEY_FORMAT_VERSION,
    SEGMENTATION_VERSION,
    NORMALIZATION_VERSION,
    PLACEHOLDER_VERSION,
    locale,
    unit.patternText,
    typeSignature,
    digest,
  ]);

  const plainKeyHash = tmHashFields([
    'pk' + KEY_FORMAT_VERSION,
    SEGMENTATION_VERSION,
    NORMALIZATION_VERSION,
    PLACEHOLDER_VERSION,
    locale,
    stripFormatMarkers(unit.patternText),
    typeSignature,
    digest,
  ]);

  const contextHash = tmHashFields([
    'ck' + CONTEXT_VERSION,
    ctx.before || BOF,
    ctx.after || EOF,
    unit.container,
  ]);

  return {
    segmentKey,
    plainKeyHash,
    contextHash,
    sourceFingerprint: tmHash128(unit.rawText),
  };
};
