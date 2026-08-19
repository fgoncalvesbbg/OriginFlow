/**
 * Shared shapes for the segment-level translation memory (TM) core.
 *
 * These types live in one leaf module with no imports of their own so every TM
 * module (segmentation, normalization, placeholders, keys, similarity,
 * reassembly) can depend on them without an import cycle, and so a Netlify
 * commit function can import the payload shapes without dragging in the data
 * layer.
 *
 * The TM operates on SEGMENTS — roughly one sentence, list item, table cell or
 * heading — not on whole HTML fragments the way translation.service.ts's session
 * cache does. A "fragment" here is still what im-translation-fragments.ts
 * collects (one `Record<lang, html>` slot: a section title, one inline block's
 * content, a sku-slot label, or legacy section content); a fragment is
 * decomposed into segments, each looked up and stored independently, then the
 * fragment is rebuilt.
 */

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/**
 * What a `{{Tn:identity}}` marker inside a segment stands for.
 *
 * `placeholder_chip` / `condition_chip` / `image` correspond to a `{{FRZ_n}}`
 * token produced by im-chip-freeze.ts — the marker carries the FRAGMENT-level
 * frozen index so reassembly can renumber correctly. `inline_open` /
 * `inline_close` / `br` are ordinary formatting tags kept inside the segment
 * (rather than pushed to the skeleton) because prose routinely flows through
 * them: "Fill to the <strong>MAX</strong> line."
 */
export type SegmentTokenKind =
  | 'placeholder_chip'
  | 'condition_chip'
  | 'image'
  | 'inline_open'
  | 'inline_close'
  | 'br';

export interface SegmentToken {
  /** Renumbered from 0 WITHIN the segment — this is what makes the key position-independent. */
  localId: number;
  kind: SegmentTokenKind;
  /** Index into `SegmentedFragment.frozen`. Set only for chip/image tokens. */
  frozenIndex?: number;
  /**
   * Class-level identity used in `keyText` and in every multiset integrity gate:
   * `chip.<data-attr-id|data-feature-id|data-id>`, `cond.<...>`, `img`,
   * `o.strong` / `c.strong`, `br`. Deliberately NOT the raw markup, so the same
   * chip appearing in two different blocks compares equal.
   */
  identity: string;
  /** Verbatim original markup. Set for inline tags and <br> only; re-emitted on reassembly. */
  raw?: string;
}

/** A fragment is an ordered list of untranslatable skeleton runs and segment holes. */
export type FragmentPart =
  | { kind: 'skeleton'; text: string }
  | { kind: 'segment'; segmentIndex: number };

export interface Segment {
  index: number;
  /**
   * Structure-derived, index-independent location, e.g. `p[2]/s0`,
   * `table/tbody/tr[1]/td[0]/s0`, `ul/li[3]/s1`. Lets a stored row be re-matched
   * after an English edit re-segments the fragment.
   */
  anchorPath: string;
  /** `p` | `h2` | `li` | `td` | `th` | `root` ... */
  container: string;
  ordinalInContainer: number;
  /**
   * Byte-exact slice of the FROZEN fragment text, i.e. still carrying
   * fragment-global `{{FRZ_n}}` numbering. This is what gets sent to the
   * translation engine on a miss, and what is stored as the row's raw source.
   */
  rawText: string;
  /**
   * Position-independent form: identical prose with tokens renumbered from 0 as
   * typed `{{Tn:identity}}` markers. The basis of every key and comparison.
   */
  keyText: string;
  tokens: SegmentToken[];
}

/**
 * Where a segment came from, in terms stable enough to re-find it later.
 *
 * `structuralPath` is index-independent, so after an English edit re-segments a
 * fragment a stored row can be re-matched on (structuralPath, key) before falling
 * back to key alone and finally to ordinal position.
 */
export interface SegmentAnchor {
  /** The im-translation-fragments id, e.g. `<sectionId>#inline:3`. */
  fragmentId: string;
  /** Ordinal within the fragment. */
  index: number;
  structuralPath: string;
  container: string;
}

/** Why a fragment cannot participate in the TM and must fall back to whole-fragment translation. */
export type FragmentIneligibleReason = 'ambiguous_markup' | 'too_many_segments';

export interface SegmentedFragment {
  segmentationVersion: number;
  sourceLang: string;
  /** Straight from `freeze()` — fragment-global chip/<img> payloads. */
  frozen: string[];
  /** The frozen fragment text; `parts` reproduce this byte-for-byte. */
  frozenText: string;
  /** The original, unmodified HTML handed in. */
  sourceHtml: string;
  parts: FragmentPart[];
  segments: Segment[];
  /** True when a protected (verbatim) phrase suppressed a sentence cut. */
  protectedCutSuppressed: boolean;
  ineligibleReason?: FragmentIneligibleReason;
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

/**
 * Typed placeholders extracted from a segment's prose, on top of the chip/image
 * tokens. Strictly limited to numerals, units, identifiers, brands, URLs, dates
 * and cross-references — NEVER nouns, adjectives or verbs, because re-injecting
 * a lexical item into an inflected or gendered target language produces
 * grammatically wrong output.
 */
export type PlaceholderType =
  | 'measure'
  | 'num'
  | 'code'
  | 'brand'
  | 'url'
  | 'date'
  | 'xref'
  | 'regnum';

export interface ExtractedPlaceholder {
  /** Marker is `{{P<index>}}`; numbering follows document order of occurrence. */
  index: number;
  type: PlaceholderType;
  /** The literal source text, exactly as it appeared in the normalized segment. */
  value: string;
  /** Locale-neutral comparison form: `2.5|l`, `EN60335-1`, `2024-05-01`. */
  canonical: string;
  /** Locale-neutral numeric part, `.` as decimal separator. Set for `measure` / `num`. */
  numeric?: string;
  /** Symbol unit as written. Set for `measure`. */
  unit?: string;
}

export type PlaceholderUnsafeReason =
  | 'numeral_adjacent_to_word'
  | 'ordinal'
  | 'segment_initial_placeholder'
  | 'group_separated_number'
  | 'too_many_placeholders';

export interface PlaceholderedSegment {
  /**
   * THE MATCHING FORM. On a placeholder-safe segment the detected values are
   * replaced by `{{Pn}}`; on an unsafe one the literals are kept, so an unsafe
   * segment can still match another identical unsafe segment exactly — it just
   * cannot lend its target to a segment with different values.
   */
  patternText: string;
  /** Re-injectable placeholders. Empty when `!placeholderSafe`. */
  placeholders: ExtractedPlaceholder[];
  /**
   * Every candidate found, ALWAYS populated even when unsafe — the similarity
   * scorer needs these to cap a match whose numeral/unit/identifier differs.
   */
  detected: ExtractedPlaceholder[];
  placeholderSafe: boolean;
  unsafeReasons: PlaceholderUnsafeReason[];
  /** False when there is no real prose to translate (`<td>230 V</td>`) — not a TM unit. */
  translatable: boolean;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface SegmentKeys {
  /** The exact-match key: placeholdered normalized source + locale + versions + ordered types. */
  segmentKey: string;
  /** Formatting-insensitive key. FUZZY INDEX ONLY — never grounds an auto-apply. */
  plainKeyHash: string;
  /** Hash of the neighbouring segments' pattern text plus the container kind. */
  contextHash: string;
  /** Byte-level hash of `rawText`, for staleness and exact-duplicate detection. */
  sourceFingerprint: string;
}

export interface KeyContext {
  /** Normalized pattern text of the preceding segment, or '' at the start of the fragment. */
  before: string;
  /** Normalized pattern text of the following segment, or '' at the end of the fragment. */
  after: string;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

export type CompareTokenClass = 'word' | 'number' | 'identifier' | 'unit' | 'marker' | 'punct';

export interface CompareToken {
  text: string;
  cls: CompareTokenClass;
  /** Comparison key: lowercased for words, canonical numeric for numbers, identity for markers. */
  key: string;
}

export type DiffOp =
  | { op: 'equal'; text: string }
  | { op: 'insert'; text: string }
  | { op: 'delete'; text: string }
  | { op: 'replace'; from: string; to: string; critical: boolean };

/**
 * How good a candidate is, in the vocabulary the retrieval cascade uses.
 *
 * `exact_in_context` is the source spec's "perfect" tier (source + context +
 * domain all match); `exact` is source-only. `fuzzy_auto` is a near-identical
 * source safe to auto-apply; `fuzzy_review` must be shown to a human;
 * `reference` is only good enough to hand the engine as a style hint.
 */
export type MatchTier =
  | 'exact_in_context'
  | 'exact'
  | 'fuzzy_auto'
  | 'fuzzy_review'
  | 'reference'
  | 'none';

export interface ScoreResult {
  /** 0-100, token-level. */
  score: number;
  /** True when a numeral, unit, identifier or chip differs — caps the score below auto-apply. */
  criticalDiff: boolean;
  /** True when the ONLY differences are inline-formatting markers. */
  formatOnly: boolean;
  ops: DiffOp[];
}

// ---------------------------------------------------------------------------
// Reassembly
// ---------------------------------------------------------------------------

export interface TranslatedSegment {
  segmentIndex: number;
  /** Target text in the SAME marker vocabulary as `Segment.keyText`: prose + `{{Tn:...}}` + `{{Pn}}`. */
  targetKeyText: string;
  origin: 'tm_exact' | 'tm_fuzzy' | 'engine' | 'human' | 'copy_source';
}

export type ReassemblyFailureCode =
  | 'token_multiset_mismatch'
  | 'placeholder_missing'
  | 'placeholder_unknown_index'
  | 'placeholder_type_mismatch'
  | 'unbalanced_inline_tags'
  | 'marker_residue'
  | 'fragment_token_count_mismatch';

export interface ReassemblyFailure {
  segmentIndex?: number;
  code: ReassemblyFailureCode;
  detail: string;
}

export interface ReassembleResult {
  html: string;
  /** False means NOTHING was applied and `html` is the untouched source — callers must not persist a failure. */
  ok: boolean;
  failures: ReassemblyFailure[];
  perSegment: Array<{ segmentIndex: number; applied: boolean; reason?: ReassemblyFailureCode }>;
}
