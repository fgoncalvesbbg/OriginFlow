/**
 * Splits one IM content fragment into translation-memory segments.
 *
 * A "fragment" is what im-translation-fragments.ts collects: the HTML in one
 * `Record<lang, string>` slot — a section title, one inline block's content, a
 * sku-slot label, or legacy section content. A single inline block routinely
 * holds several paragraphs, a table, a list and a callout, so the fragment is far
 * too coarse to be a reuse unit: two blocks whose safety paragraph differs by one
 * word currently share nothing. This module cuts a fragment into sentence-scale
 * units — one per sentence, list item, table cell and heading — which is the
 * granularity at which regulated documentation actually repeats.
 *
 * THE ANCHOR, and why reassembly is not string surgery
 * ----------------------------------------------------
 * A fragment becomes an ordered `parts` list of untranslatable `skeleton` runs
 * and `segment` HOLES. Every tag, every chip, every scrap of inter-sentence
 * whitespace lives in a skeleton run; only prose lives in a segment. Reassembly
 * is therefore array substitution, and the invariant
 *
 *   parts.map(skeleton.text | segments[i].rawText).join('') === freeze(html).text
 *   thaw(that, frozen) === html                              (BYTE-IDENTICAL)
 *
 * holds for every input, which is the whole guarantee that matters for regulated
 * content. It is asserted over a corpus in the test suite.
 *
 * BIAS: WHEN IN DOUBT, DO NOT CUT
 * -------------------------------
 * An over-merged segment is still a valid, reusable unit that costs a little
 * leverage. A wrongly-cut segment is a half-sentence that is stored forever,
 * matched against forever, and eventually printed. Every ambiguous case below
 * therefore resolves to "no boundary".
 *
 * `SEGMENTATION_VERSION` is part of every key. Changing the rules orphans the
 * existing corpus, so a change is a migration (re-segment and re-key from each
 * row's stored raw source), never a silent redeploy — and retrieval refuses
 * hash-equality tiers across versions so a forgotten bump degrades to misses.
 *
 * Pure string functions, no DOM, so this runs identically in the browser and
 * under Node/vitest — same convention as im-chip-freeze.ts.
 */

import { freeze } from './im-chip-freeze';
import { isNoBreakAfter } from './im-tm-abbreviations.i18n';
import type {
  FragmentPart,
  Segment,
  SegmentToken,
  SegmentTokenKind,
  SegmentedFragment,
} from './im-tm-types';

export const SEGMENTATION_VERSION = 1;

/** Beyond this a fragment is pathological; treat it as one opaque unit rather than shredding it. */
const MAX_SEGMENTS_PER_FRAGMENT = 200;

// ---------------------------------------------------------------------------
// Tag vocabulary
// ---------------------------------------------------------------------------

/** Tags that HOLD segments. Their text content becomes one or more segments. */
const CONTAINER_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th', 'caption', 'figcaption', 'blockquote', 'dt', 'dd',
]);

/**
 * Containers whose text may be split into sentences. Everything else in
 * `CONTAINER_TAGS` is ATOMIC — a heading or a table cell is never cut internally,
 * which is both how every CAT tool treats cells and the cheapest way to make
 * `<td>Max. 2.5 l</td>` impossible to mangle.
 */
const SPLITTABLE_CONTAINERS = new Set(['p', 'li', 'blockquote', 'dd', 'root']);

/** Pure structure: pushes the path, holds no text of its own. */
const STRUCTURE_TAGS = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'dl', 'div', 'section',
  'article', 'figure', 'colgroup', 'header', 'footer', 'main', 'aside', 'nav',
  'form', 'fieldset',
]);

/**
 * Formatting tags kept INSIDE a segment, because prose flows through them.
 *
 * `span` belongs here even though every span the IM editor emits is a chip that
 * `freeze()` has already removed: were a bare span to survive, treating it as
 * structure would fence the sentence around it and produce exactly the
 * half-segments this module exists to avoid.
 */
const INLINE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'small', 'code', 'kbd',
  'var', 'abbr', 'a', 'mark', 'q', 'cite', 'time', 'label', 'big', 'tt', 'span',
]);

/** Never pushes/pops the path stack. */
const VOID_TAGS = new Set([
  'br', 'hr', 'col', 'img', 'input', 'wbr', 'source', 'track', 'area', 'base',
  'link', 'meta', 'param', 'embed',
]);

// ---------------------------------------------------------------------------
// Atom tokenizer
// ---------------------------------------------------------------------------

/**
 * Splits into `{{FRZ_n}}` tokens, HTML comments, HTML tags and plain-text runs.
 * Same shape as im-xliff-codec's SEGMENT_RE, extended with comments so a stale
 * marker (`<!--im-en-src:HASH-->`) lands in the skeleton instead of polluting a
 * segment's prose.
 */
const ATOM_RE =
  /(\{\{FRZ_\d+\}\}|<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>)/;

type AtomKind = 'text' | 'tag' | 'frz' | 'comment';

interface Atom {
  s: string;
  kind: AtomKind;
  /** Lowercased tag name, for `kind === 'tag'`. */
  name?: string;
  closing?: boolean;
  selfClosing?: boolean;
  /** Index into the fragment's `frozen` array, for `kind === 'frz'`. */
  frozenIndex?: number;
}

const tagNameOf = (tag: string): string => {
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
  return m ? m[1].toLowerCase() : '';
};

const toAtoms = (text: string): Atom[] => {
  const out: Atom[] = [];
  for (const raw of text.split(ATOM_RE)) {
    if (!raw) continue;
    const frz = /^\{\{FRZ_(\d+)\}\}$/.exec(raw);
    if (frz) {
      out.push({ s: raw, kind: 'frz', frozenIndex: Number(frz[1]) });
      continue;
    }
    if (raw.startsWith('<!--')) {
      out.push({ s: raw, kind: 'comment' });
      continue;
    }
    if (raw[0] === '<') {
      out.push({
        s: raw,
        kind: 'tag',
        name: tagNameOf(raw),
        closing: raw.startsWith('</'),
        selfClosing: /\/>\s*$/.test(raw),
      });
      continue;
    }
    out.push({ s: raw, kind: 'text' });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Markup-ambiguity guard
// ---------------------------------------------------------------------------

/**
 * True when the naive `<...>` tag grammar this module (and im-find-replace, and
 * im-xliff-codec) relies on cannot be trusted for this input: a `>` hiding inside
 * a quoted attribute value, an unterminated tag, or a `>` inside a comment.
 *
 * The existing modules carry this limitation silently. Here it is checked and
 * converted into a graceful degradation — the fragment is declared ineligible and
 * the caller falls back to whole-fragment translation — rather than into a
 * corrupted segment boundary.
 */
export const hasAmbiguousMarkup = (frozenText: string): boolean => {
  const s = frozenText;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '<') continue;

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i);
      if (end === -1) return true;
      const gt = s.indexOf('>', i + 4);
      if (gt !== -1 && gt < end) return true;
      i = end + 2;
      continue;
    }

    let j = i + 1;
    let quote: string | null = null;
    while (j < s.length) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= s.length) return true;
    if (s.indexOf('>', i) !== j) return true;
    i = j;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Prose detection
// ---------------------------------------------------------------------------

const stripNonProse = (s: string): string =>
  s
    .replace(/\{\{FRZ_\d+\}\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, ' ');

/**
 * True when a run carries text worth translating.
 *
 * The test is "contains a word of at least two letters", not "contains any
 * character": `<td>230 V</td>` and `<td>2.5 l</td>` are pure data and must not
 * become TM rows, while "Max. 2.5 l" must. A bare unit header such as `<th>kg`
 * slips through as a harmless row — over-inclusion here costs nothing, whereas
 * excluding real prose would silently drop it from translation entirely.
 */
const hasTranslatableProse = (s: string): boolean => /[\p{L}]{2,}/u.test(stripNonProse(s));

const wordCharCount = (s: string): number =>
  (stripNonProse(s).match(/[\p{L}\p{N}]/gu) ?? []).length;

// ---------------------------------------------------------------------------
// Sentence boundaries
// ---------------------------------------------------------------------------

/** Stands for one tag / token / comment atom in the probe string. */
const SENTINEL = String.fromCharCode(0);

const TERMINATORS = new Set(['.', '!', '?', String.fromCharCode(0x2026)]);
const CLOSERS = new Set([')', ']', '}', '"', "'", String.fromCharCode(0x00bb), String.fromCharCode(0x201d), String.fromCharCode(0x2019)]);

const OPENERS =
  String.fromCharCode(0x00ab) + String.fromCharCode(0x201c) + String.fromCharCode(0x201e) +
  String.fromCharCode(0x00a1) + String.fromCharCode(0x00bf) + String.fromCharCode(0x2022) +
  String.fromCharCode(0x2013);

/**
 * True when a character can begin a sentence: an uppercase letter, a digit, an
 * opening quote/bracket/bullet, or a tag boundary — the last of these matters
 * because "...line. <strong>Warning</strong>" must still cut.
 */
const startsSentence = (ch: string): boolean =>
  ch === SENTINEL || new RegExp('[\\p{Lu}\\p{Nd}' + OPENERS + '"\'(\\[-]', 'u').test(ch);

/** A single initial ("J.") or a lettered enumerator ("a.") never ends a sentence. */
const INITIAL_OR_ENUMERATOR_RE = new RegExp('(?:^|[\\s(' + SENTINEL + '])\\p{L}\\.$', 'u');

/**
 * A list number ("1. Open the lid.") or a cross-reference ("See 4.2. Then...").
 * Deliberately conservative: rejecting a real boundary costs leverage, accepting
 * a false one costs correctness.
 */
const NUMERIC_REF_RE = new RegExp('(?:^|[\\s(' + SENTINEL + '])\\d{1,3}(?:\\.\\d{1,3})*\\.$');

interface ProbeMap {
  probe: string;
  /** Offset in the real (pending) string where each probe character starts. */
  realStart: number[];
  /** Length in the real string of each probe character. */
  realLen: number[];
}

const buildProbe = (atoms: Atom[]): ProbeMap => {
  const chars: string[] = [];
  const realStart: number[] = [];
  const realLen: number[] = [];
  let off = 0;
  for (const a of atoms) {
    if (a.kind === 'text') {
      for (const ch of a.s) {
        chars.push(ch);
        realStart.push(off);
        realLen.push(ch.length);
        off += ch.length;
      }
    } else {
      chars.push(SENTINEL);
      realStart.push(off);
      realLen.push(a.s.length);
      off += a.s.length;
    }
  }
  return { probe: chars.join(''), realStart, realLen };
};

/** Case-sensitive, longest-first, non-overlapping occurrences of protected phrases. */
const protectedRangesIn = (s: string, phrases: string[]): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  const sorted = [...phrases].filter((p) => p && p.trim()).sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    let from = 0;
    for (;;) {
      const at = s.indexOf(phrase, from);
      if (at === -1) break;
      const end = at + phrase.length;
      const overlaps = ranges.some(([a, b]) => at < b && end > a);
      if (!overlaps) ranges.push([at, end]);
      from = at + 1;
    }
  }
  return ranges;
};

// ---------------------------------------------------------------------------
// Token identity
// ---------------------------------------------------------------------------

const sanitizeIdentity = (s: string): string => s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 48);

const attr = (markup: string, name: string): string | null => {
  const m = new RegExp(name + '="([^"]*)"', 'i').exec(markup);
  return m ? m[1] : null;
};

/**
 * Class-level identity of a frozen chip / image, used in `keyText` and in the
 * reassembly multiset gate.
 *
 * Deliberately NOT the raw markup: the same placeholder chip in two different
 * blocks must compare equal so their sentences share one TM row. The attribute
 * precedence mirrors how im-resolver reads chips.
 */
const frozenIdentity = (payload: string): { kind: SegmentTokenKind; identity: string } => {
  const lower = payload.toLowerCase();
  if (lower.startsWith('<img')) return { kind: 'image', identity: 'img' };
  if (/im-condition/i.test(payload)) {
    const id = attr(payload, 'data-feature-id') ?? attr(payload, 'data-id') ?? '';
    return { kind: 'condition_chip', identity: 'cond.' + sanitizeIdentity(id) };
  }
  if (/im-placeholder/i.test(payload)) {
    const id = attr(payload, 'data-attr-id') ?? attr(payload, 'data-id') ?? '';
    return { kind: 'placeholder_chip', identity: 'chip.' + sanitizeIdentity(id) };
  }
  // freeze() only ever produces chips and <img>; anything else is a future token
  // kind and is treated as an opaque chip rather than as translatable prose.
  return { kind: 'placeholder_chip', identity: 'frz' };
};

/**
 * Build a segment's `keyText` and token list from its raw (frozen) text.
 *
 * Renumbering tokens from 0 WITHIN the segment is the mechanical heart of the
 * whole design: `freeze()` numbers tokens per FRAGMENT, so the same sentence in
 * block 3 and block 17 arrives as `{{FRZ_0}}` and `{{FRZ_9}}`. Without
 * renumbering those two sentences would never share a TM row.
 *
 * Inline formatting IS part of the key. "Fill to the <strong>MAX</strong> line."
 * and "Fill to the MAX line." are separate entries, because target word order
 * makes re-deriving tag positions impossible — reusing one target for the other
 * source would silently drop or add emphasis in a regulated instruction. The
 * formatting-insensitive key in im-tm-key.ts is a fuzzy index only.
 */
const buildSegmentText = (
  rawText: string,
  frozen: string[],
): { keyText: string; tokens: SegmentToken[] } => {
  const tokens: SegmentToken[] = [];
  let keyText = '';

  const emit = (kind: SegmentTokenKind, identity: string, extra: Partial<SegmentToken>): void => {
    const localId = tokens.length;
    tokens.push({ localId, kind, identity, ...extra });
    keyText += '{{T' + localId + ':' + identity + '}}';
  };

  for (const atom of toAtoms(rawText)) {
    if (atom.kind === 'text') {
      keyText += atom.s;
      continue;
    }
    if (atom.kind === 'frz') {
      const payload = frozen[atom.frozenIndex ?? -1] ?? '';
      const { kind, identity } = frozenIdentity(payload);
      emit(kind, identity, { frozenIndex: atom.frozenIndex });
      continue;
    }
    if (atom.kind === 'comment') {
      // Comments never reach here (they fence a segment), but be explicit rather
      // than letting one fall through into prose.
      continue;
    }
    const name = atom.name ?? '';
    if (name === 'br') {
      emit('br', 'br', { raw: atom.s });
      continue;
    }
    if (atom.closing) {
      emit('inline_close', 'c.' + sanitizeIdentity(name), { raw: atom.s });
      continue;
    }
    emit('inline_open', 'o.' + sanitizeIdentity(name), { raw: atom.s });
  }

  return { keyText, tokens };
};

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export interface SegmentOptions {
  /** Selects the abbreviation exception list. `en` today — see im-tm-abbreviations.i18n.ts. */
  sourceLang: string;
  /**
   * Phrases a sentence boundary must never fall inside — the mandated regulation
   * wording from `translation_verbatims`. Cutting through one would send it to
   * the engine in halves and later trip `findVerbatimViolations` at publish time.
   */
  protectedPhrases?: string[];
}

interface StackEntry {
  name: string;
  ordinal: number;
  counts: Map<string, number>;
}

const ineligible = (
  sourceHtml: string,
  frozenText: string,
  frozen: string[],
  sourceLang: string,
  reason: SegmentedFragment['ineligibleReason'],
): SegmentedFragment => ({
  segmentationVersion: SEGMENTATION_VERSION,
  sourceLang,
  frozen,
  frozenText,
  sourceHtml,
  parts: frozenText ? [{ kind: 'skeleton', text: frozenText }] : [],
  segments: [],
  protectedCutSuppressed: false,
  ineligibleReason: reason,
});

/**
 * Cut one fragment's HTML into segments.
 *
 * Never throws. A fragment it cannot safely handle comes back with
 * `ineligibleReason` set, zero segments, and everything in the skeleton — which
 * reassembles to the original HTML byte-for-byte, so the caller can fall back to
 * today's whole-fragment `translateHtml` with no special-casing.
 */
export const segmentFragment = (
  sourceHtml: string,
  opts: SegmentOptions,
): SegmentedFragment => {
  const sourceLang = opts.sourceLang || 'en';
  const { text: frozenText, frozen } = freeze(sourceHtml ?? '');

  if (!frozenText) {
    return {
      segmentationVersion: SEGMENTATION_VERSION,
      sourceLang,
      frozen,
      frozenText,
      sourceHtml: sourceHtml ?? '',
      parts: [],
      segments: [],
      protectedCutSuppressed: false,
    };
  }

  if (hasAmbiguousMarkup(frozenText)) {
    return ineligible(sourceHtml, frozenText, frozen, sourceLang, 'ambiguous_markup');
  }

  const protectedPhrases = opts.protectedPhrases ?? [];
  const parts: FragmentPart[] = [];
  const segments: Segment[] = [];
  const stack: StackEntry[] = [];
  const rootCounts = new Map<string, number>();

  let skeleton = '';
  let pending: Atom[] = [];
  let protectedCutSuppressed = false;
  /**
   * Segment ordinals are counted per structural path, not reset when a container
   * closes. `<td><p>A.</p> tail</td>` must not give the `<p>` segment and the
   * tail segment the same anchor just because both sit at ordinal 0 of their
   * respective containers.
   */
  const pathOrdinals = new Map<string, number>();

  const pushSkeleton = (s: string): void => {
    if (s) skeleton += s;
  };
  const flushSkeleton = (): void => {
    if (skeleton) {
      parts.push({ kind: 'skeleton', text: skeleton });
      skeleton = '';
    }
  };

  const currentPath = (): string =>
    stack.map((e) => e.name + '[' + e.ordinal + ']').join('/');

  const countsOfParent = (): Map<string, number> =>
    stack.length ? stack[stack.length - 1].counts : rootCounts;

  /**
   * The nearest enclosing tag that HOLDS text, which decides both splittability
   * and the reported container. Text sitting directly in a `<div>` or at the top
   * of the fragment (a section title, a sku label) reports `root`.
   */
  const nearestContainer = (): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (CONTAINER_TAGS.has(stack[i].name)) return stack[i].name;
    }
    return 'root';
  };

  /** Emit one segment for `core`, which is guaranteed to be trimmed and to hold prose. */
  const emitSegment = (core: string): void => {
    const { keyText, tokens } = buildSegmentText(core, frozen);
    const index = segments.length;
    const base = currentPath();
    const ordinal = pathOrdinals.get(base) ?? 0;
    pathOrdinals.set(base, ordinal + 1);
    segments.push({
      index,
      anchorPath: (base ? base + '/' : '') + 's' + ordinal,
      container: nearestContainer(),
      ordinalInContainer: ordinal,
      rawText: core,
      keyText,
      tokens,
    });
    flushSkeleton();
    parts.push({ kind: 'segment', segmentIndex: index });
  };

  /** Split one piece into leading whitespace / prose core / trailing whitespace. */
  const emitPiece = (piece: string): void => {
    if (!piece) return;
    if (!hasTranslatableProse(piece)) {
      pushSkeleton(piece);
      return;
    }
    const lead = /^\s+/.exec(piece)?.[0] ?? '';
    const rest = piece.slice(lead.length);
    const trail = /\s+$/.exec(rest)?.[0] ?? '';
    const core = rest.slice(0, rest.length - trail.length);
    if (!core) {
      pushSkeleton(piece);
      return;
    }
    pushSkeleton(lead);
    emitSegment(core);
    pushSkeleton(trail);
  };

  const flushPending = (): void => {
    if (!pending.length) return;
    const atoms = pending;
    pending = [];
    const pstr = atoms.map((a) => a.s).join('');

    if (!hasTranslatableProse(pstr)) {
      pushSkeleton(pstr);
      return;
    }

    if (!SPLITTABLE_CONTAINERS.has(nearestContainer())) {
      emitPiece(pstr);
      return;
    }

    const { probe, realStart, realLen } = buildProbe(atoms);
    const n = probe.length;
    const protectedRanges = protectedPhrases.length
      ? protectedRangesIn(pstr, protectedPhrases)
      : [];

    const candidates: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!TERMINATORS.has(probe[i])) continue;

      // Absorb a run of further terminators and closing punctuation ("...!)").
      let j = i;
      while (j + 1 < n && (TERMINATORS.has(probe[j + 1]) || CLOSERS.has(probe[j + 1]))) j++;
      if (j + 1 >= n) break; // container tail — no boundary needed
      if (!/\s/.test(probe[j + 1])) continue; // "2.5", "e.g.x", "example.com"

      const upTo = probe.slice(0, i + 1);
      if (isNoBreakAfter(upTo, sourceLang)) continue;
      if (INITIAL_OR_ENUMERATOR_RE.test(upTo)) continue;
      if (NUMERIC_REF_RE.test(upTo)) continue;

      let k = j + 1;
      while (k < n && /\s/.test(probe[k])) k++;
      if (k >= n) break;
      if (!startsSentence(probe[k])) continue;

      const cutAt = realStart[j] + realLen[j];
      if (protectedRanges.some(([a, b]) => cutAt > a && cutAt < b)) {
        protectedCutSuppressed = true;
        continue;
      }
      candidates.push(cutAt);
      i = j;
    }

    // Minimum-piece guard: never leave a fragment of fewer than two word
    // characters on either side of a boundary.
    const accepted: number[] = [];
    let prev = 0;
    for (const c of candidates) {
      if (wordCharCount(pstr.slice(prev, c)) < 2) continue;
      accepted.push(c);
      prev = c;
    }
    if (accepted.length && wordCharCount(pstr.slice(prev)) < 2) accepted.pop();

    const bounds = [0, ...accepted, pstr.length];
    for (let b = 0; b < bounds.length - 1; b++) {
      emitPiece(pstr.slice(bounds[b], bounds[b + 1]));
    }
  };

  for (const atom of toAtoms(frozenText)) {
    if (atom.kind === 'text' || atom.kind === 'frz') {
      pending.push(atom);
      continue;
    }

    if (atom.kind === 'comment') {
      flushPending();
      pushSkeleton(atom.s);
      continue;
    }

    const name = atom.name ?? '';

    if (INLINE_TAGS.has(name) && !VOID_TAGS.has(name)) {
      pending.push(atom);
      continue;
    }

    // Everything from here fences the current segment run.
    if (name === 'br') {
      // A hard fence. <br>-separated lines in a manual are line-like units, and
      // fencing keeps reassembly trivially lossless. The cost is that a sentence
      // deliberately broken across a <br> yields two half-segments; that is a
      // known, versioned quality trade-off and the first knob to revisit.
      flushPending();
      pushSkeleton(atom.s);
      continue;
    }

    if (VOID_TAGS.has(name)) {
      flushPending();
      pushSkeleton(atom.s);
      continue;
    }

    flushPending();
    pushSkeleton(atom.s);

    if (atom.selfClosing) continue;

    if (atom.closing) {
      const top = stack[stack.length - 1];
      if (top && top.name === name) stack.pop();
      // else: unbalanced markup — keep the skeleton byte-exact and ignore it for
      // path purposes rather than guessing at the author's intent.
      continue;
    }

    // Containers, structure, and any unrecognized tag all push the path. Treating
    // an unknown tag as structure is the safe default: guessing it were inline
    // would let it become a segment token and silently change the key.
    const counts = countsOfParent();
    const ordinal = counts.get(name) ?? 0;
    counts.set(name, ordinal + 1);
    stack.push({ name, ordinal, counts: new Map() });
  }

  flushPending();
  flushSkeleton();

  if (segments.length > MAX_SEGMENTS_PER_FRAGMENT) {
    return ineligible(sourceHtml, frozenText, frozen, sourceLang, 'too_many_segments');
  }

  return {
    segmentationVersion: SEGMENTATION_VERSION,
    sourceLang,
    frozen,
    frozenText,
    sourceHtml: sourceHtml ?? '',
    parts,
    segments,
    protectedCutSuppressed,
  };
};

/**
 * Reproduce the frozen fragment text from `parts`, optionally substituting
 * replacement text for individual segments. With no replacements this is the
 * losslessness identity and is asserted across a corpus in the tests.
 */
export const renderParts = (
  sf: SegmentedFragment,
  replacements?: Map<number, string>,
): string =>
  sf.parts
    .map((p) =>
      p.kind === 'skeleton'
        ? p.text
        : replacements?.get(p.segmentIndex) ?? sf.segments[p.segmentIndex].rawText,
    )
    .join('');
