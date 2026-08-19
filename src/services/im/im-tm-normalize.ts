/**
 * Canonical form of a segment, used ONLY for translation-memory matching.
 *
 * Normalized text is never published, never shown to a translator, and never
 * stored as a target — it exists so that two segments differing only in a
 * non-breaking space, a curly apostrophe, or an en dash resolve to the same TM
 * key instead of paying for the same translation twice.
 *
 * `NORMALIZATION_VERSION` is part of every key. Changing any rule below changes
 * every hash in the corpus, which is a MIGRATION (rebuild keys from each row's
 * stored raw source), not a silent redeploy. Retrieval refuses hash-equality
 * tiers across differing versions precisely so a forgotten bump degrades to
 * cache misses rather than to wrong reuse.
 *
 * Deliberately preserved: CASE and ACCENTS. "MAX" and "max" are different in a
 * regulated instruction, and an accent difference is a real spelling difference,
 * not noise. Case-folding lives in `normalizeLoose`, which is a fuzzy-recall
 * index only and can never ground an auto-apply.
 *
 * NOTE on im-publish.service.ts's private `normText`: it does a subset of this
 * (NBSP plus whitespace collapse) and feeds `findVerbatimViolations`, which
 * hard-blocks FINAL manuals and is deliberately case- and punctuation-sensitive.
 * Widening it to this function would silently loosen that gate, so publish is
 * left alone; `normalizeWhitespace` below is exported as the shared primitive if
 * that convergence is ever made deliberately.
 *
 * Character classes are assembled from code points via `String.fromCharCode`
 * rather than written as literals or string escapes. Every character this module
 * cares about is by definition invisible or easily confused, so spelling them
 * out inline produces source that an editor, a diff, or a linter autofix can
 * silently corrupt — and a corrupted normalizer is a corrupted corpus.
 */

import { unescapeEntities } from './im-xliff-codec';

export const NORMALIZATION_VERSION = 1;

const chr = String.fromCharCode;
/** An inclusive code-point range, as it appears inside a character class. */
const range = (from: number, to: number): string => chr(from) + '-' + chr(to);
const charClass = (...parts: string[]): RegExp => new RegExp('[' + parts.join('') + ']', 'g');

/** Zero-width and formatting characters that carry no meaning and must not affect a key. */
const INVISIBLES_RE = charClass(
  range(0x200b, 0x200d), // ZWSP, ZWNJ, ZWJ
  chr(0x2060), //           word joiner
  chr(0xfeff), //           BOM / ZWNBSP
  chr(0x00ad), //           soft hyphen
  chr(0x034f), //           combining grapheme joiner
  chr(0x180e), //           Mongolian vowel separator
);

/**
 * Entities that stand for a space. Decoded to a plain space BEFORE the general
 * entity pass so they go down the whitespace-collapse path rather than becoming
 * an exotic space character that then has to be re-recognized.
 */
const SPACE_ENTITY_RE =
  /&(?:nbsp|ensp|emsp|thinsp|hairsp|numsp|puncsp|#160|#xA0|#xa0|#8194|#8195|#8201|#8239|#x202F|#x202f);/g;

/**
 * Every space-like character maps to a plain space, and so does every remaining
 * control character. Mapping controls here is what lets `HASH_FIELD_SEP`
 * (U+001F) be a safe, unforgeable field delimiter in composite hash inputs:
 * normalized text provably cannot contain one.
 */
const SPACE_LIKE_RE = charClass(
  range(0x09, 0x0d), //     tab, LF, VT, FF, CR
  chr(0xa0), //             NBSP
  chr(0x1680), //           Ogham space mark
  range(0x2000, 0x200a), // en/em/thin/hair spaces
  chr(0x2028), //           line separator
  chr(0x2029), //           paragraph separator
  chr(0x202f), //           narrow NBSP
  chr(0x205f), //           medium mathematical space
  chr(0x3000), //           ideographic space
);
const OTHER_CONTROL_RE = charClass(range(0x00, 0x08), range(0x0e, 0x1f), range(0x7f, 0x9f));

const SINGLE_QUOTE_RE = charClass(
  range(0x2018, 0x201b), // left/right single quote, low-9, reversed-9
  chr(0x2032), //           prime
  chr(0x00b4), //           acute accent
  chr(0x0060), //           grave accent
);
const DOUBLE_QUOTE_RE = charClass(
  range(0x201c, 0x201f), // left/right double quote, low-9, reversed-9
  chr(0x2033), //           double prime
  chr(0x00ab), //           left guillemet
  chr(0x00bb), //           right guillemet
);
/** Hyphen-like dashes. `-` itself is the target, and a deliberate `--` is NOT collapsed. */
const DASH_RE = charClass(range(0x2010, 0x2015), chr(0x2212));
const ELLIPSIS_RE = new RegExp(chr(0x2026), 'g');

/**
 * Braces must never be produced by entity decoding: a decoded `{{` would look
 * like one of our own `{{Tn:...}}` / `{{Pn}}` markers to the placeholder scanner
 * and to every integrity gate downstream.
 */
const isBrace = (cp: number): boolean => cp === 0x7b || cp === 0x7d;

const decodeEntitiesSafely = (s: string): string => {
  // Neutralize brace-producing numeric entities by re-escaping their ampersand,
  // then hand everything to the codec's decoder so entity handling stays defined
  // in exactly one place in the codebase.
  const guarded = s.replace(/&#x([0-9a-fA-F]+);|&#(\d+);/g, (m, hex: string, dec: string) => {
    const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    return Number.isFinite(cp) && isBrace(cp) ? m.replace('&', '&amp;') : m;
  });
  return unescapeEntities(guarded);
};

/** Collapse every space-like run to a single space and trim. The shared primitive. */
export const normalizeWhitespace = (s: string): string =>
  s.replace(SPACE_LIKE_RE, ' ').replace(OTHER_CONTROL_RE, ' ').replace(/ {2,}/g, ' ').trim();

/**
 * The canonical matching form of a segment's `keyText`.
 *
 * Safe to run on text containing `{{Tn:identity}}` and `{{Pn}}` markers: marker
 * bodies are restricted to `[A-Za-z0-9_.-]`, so no rule below can alter one.
 */
export const normalizeForMatch = (s: string): string => {
  if (!s) return '';
  let out = s.normalize('NFC');
  out = out.replace(SPACE_ENTITY_RE, ' ');
  out = decodeEntitiesSafely(out);
  out = out.replace(INVISIBLES_RE, '');
  out = out.replace(SINGLE_QUOTE_RE, "'");
  out = out.replace(DOUBLE_QUOTE_RE, '"');
  out = out.replace(DASH_RE, '-');
  out = out.replace(ELLIPSIS_RE, '...');
  return normalizeWhitespace(out);
};

/**
 * Terminal punctuation stripped by `normalizeLoose`. Pure ASCII because
 * `normalizeForMatch` has already turned an ellipsis into three full stops.
 */
const TRAILING_PUNCT_RE = /[.!?;:,\s]+$/;

/**
 * Case-folded, terminal-punctuation-stripped form.
 *
 * FUZZY RECALL ONLY. Never a key, never grounds an auto-apply: "Do not immerse
 * in water." and "do not immerse in water" may well be the same sentence, but
 * deciding that is a human's job, not a hash comparison's.
 */
export const normalizeLoose = (s: string): string =>
  normalizeForMatch(s).toLowerCase().replace(TRAILING_PUNCT_RE, '');
