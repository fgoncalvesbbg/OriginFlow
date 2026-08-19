/**
 * Typed placeholder extraction for translation-memory matching.
 *
 * This is the highest-leverage step in the whole TM: it is what turns
 * "The KG350 has a tank capacity of 2.5 l." into
 * "The {{P0}} has a tank capacity of {{P1}}." and thereby collapses thousands of
 * apparently unique specification sentences into a handful of reusable ones.
 *
 * Runs on the NORMALIZED `keyText` of a segment (see im-tm-normalize.ts), i.e.
 * after chip/image tokens have already become `{{Tn:identity}}` markers. Those
 * markers are skipped — no placeholder may ever start or end inside one.
 *
 * WHAT IS AND IS NOT PLACEHOLDERED
 * --------------------------------
 * Only: numerals, symbol units of measure, model/article codes, brand names,
 * URLs, dates, cross-reference numbers, and regulation identifiers.
 *
 * NEVER nouns, adjectives or verbs. Every matcher below is anchored on a digit, a
 * symbol drawn from a closed unit list, a URL/date/identifier shape, or an
 * explicitly supplied brand list — there is no rule whose match can consist only
 * of letters that were not handed to us as data. This matters because
 * re-injecting a lexical item into a language with grammatical gender, case or
 * number agreement produces confidently wrong output.
 *
 * THE SAFETY VALVE
 * ----------------
 * When the target's grammar would depend on a placeholder's VALUE — "Wait 2
 * minutes" vs "Wait 1 minute", ordinals, sentence-initial numerals — the segment
 * is marked NOT placeholder-safe and stored literally instead. `detected` is
 * still populated in that case, because the similarity scorer needs it to cap any
 * match whose numeral, unit or identifier differs.
 *
 * The heuristic deliberately errs toward "unsafe": over-marking costs leverage,
 * under-marking prints grammatically broken regulated documentation. See
 * `placeholderSafe` below for the honest list of what it cannot do.
 */

import type {
  ExtractedPlaceholder,
  PlaceholderType,
  PlaceholderUnsafeReason,
  PlaceholderedSegment,
} from './im-tm-types';

export const PLACEHOLDER_VERSION = 1;

/** More than this in one segment and re-injection ambiguity outweighs the match benefit. */
const MAX_PLACEHOLDERS = 8;

// ---------------------------------------------------------------------------
// Unit vocabulary
// ---------------------------------------------------------------------------

/**
 * SYMBOL units only — never a spelled-out word.
 *
 * "litres", "hours" and "minutes" are translatable prose and must stay in the
 * segment; a numeral followed by one of them is handled by the bare-numeral path
 * and then caught by the adjacency safety rule.
 *
 * Deliberately EXCLUDED despite being real units: `in` (inches), because it is
 * also the commonest English preposition — "5 in the box" would otherwise be read
 * as a measurement. Losing inch detection costs a little leverage on US-market
 * content; misreading a preposition as a unit corrupts a sentence.
 */
export const UNIT_SYMBOLS: string[] = [
  'mm', 'cm', 'dm', 'm', 'km', 'ft',
  'mg', 'g', 'kg', 't',
  'ml', 'cl', 'dl', 'l', 'L',
  'mW', 'W', 'kW', 'Wh', 'kWh',
  'mV', 'V', 'kV',
  'mA', 'mAh', 'A', 'Ah',
  'Hz', 'kHz', 'MHz',
  'Pa', 'kPa', 'MPa', 'bar',
  'K', 'C', 'F',
  '%', 'dB', 'dB(A)', 'rpm', 'Nm', 'lm', 'lx', 'ppm',
  'min', 's', 'h',
  'µm', 'nm',
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest-first so `kWh` wins over `Wh` over `W`, and `mAh` over `mA` over `A`. */
const UNIT_ALTERNATION = [...UNIT_SYMBOLS]
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join('|');

/** Lowercased unit symbols, for the adjacency check's "is this word actually a unit" test. */
const UNIT_WORDS = new Set(UNIT_SYMBOLS.map((u) => u.toLowerCase()));

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

interface Matcher {
  type: PlaceholderType;
  /** Lower runs first and wins an overlap. */
  priority: number;
  re: RegExp;
  /** Which capture group is the placeholder payload. 0 = whole match. */
  group?: number;
}

const DEGREE = String.fromCharCode(0x00b0);

/**
 * Ordered by how specific the shape is. Brands come first because they are
 * explicit operator-supplied data and must not be re-interpreted by a heuristic.
 */
const buildMatchers = (brands: string[]): Matcher[] => {
  const matchers: Matcher[] = [];

  if (brands.length) {
    const alternation = [...brands]
      .filter((b) => b && b.trim())
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join('|');
    if (alternation) {
      matchers.push({
        type: 'brand',
        priority: 0,
        // Case-SENSITIVE: a brand is a proper noun and "apple" is not "Apple".
        re: new RegExp('(?<![\\p{L}\\p{N}])(?:' + alternation + ')(?![\\p{L}\\p{N}])', 'gu'),
      });
    }
  }

  matchers.push(
    // (EU) 2019/2016
    { type: 'regnum', priority: 1, re: /\((?:EU|EC|EEC)\)\s?\d{4}\/\d{2,4}/g },
    // EN 60335-1, IEC 62368-1:2014
    {
      type: 'regnum',
      priority: 1,
      re: /\b(?:EN|IEC|ISO|DIN|ETSI|UL|ANSI|VDE|ASTM)\s?\d{3,5}(?:-\d{1,3})*(?::\d{4})?\b/g,
    },
    // Directive 2014/35/EU
    { type: 'regnum', priority: 1, re: /\b(?:Directive|Regulation)\s\d{4}\/\d{1,3}\/(?:EU|EC|EEC)\b/g },

    { type: 'url', priority: 2, re: /\bhttps?:\/\/[^\s<]+/g },
    { type: 'url', priority: 2, re: /\bwww\.[^\s<]+/g },
    { type: 'url', priority: 2, re: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi },

    { type: 'date', priority: 3, re: /\b\d{4}-\d{2}-\d{2}\b/g },
    { type: 'date', priority: 3, re: /\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/g },

    // "Fig. 4" -> the placeholder covers ONLY the 4. "Fig." must stay translatable
    // prose, because German writes "Abb. 4".
    //
    // The cue list includes bare reference verbs ("see 4.2", "siehe 4.2") on
    // purpose: a numeral in a reference context is a cross-reference, and typing
    // it as one keeps it clear of the bare-numeral adjacency rule below, which
    // would otherwise call "(see 4.2)" unsafe because the word "see" sits next to
    // it. A reference number never governs target agreement.
    {
      type: 'xref',
      priority: 4,
      re: new RegExp(
        '(?<=\\b(?:Fig|Figure|Abb|Abbildung|Table|Tab|Tabelle|Section|Sect|Chapter|Chap|Kapitel'
          + '|Step|Schritt|No|Nr|Item|Pos|see|refer to|siehe|voir|vea|vease|vedi|zie|patrz)'
          + '\\.?\\s)\\d+(?:\\.\\d+)*\\b',
        'gi',
      ),
    },

    // Labelled article/model codes: capture the code, not the label.
    {
      type: 'code',
      priority: 5,
      re: new RegExp(
        '(?<=\\b(?:ART|Art\\.-Nr|Item|Model|Modell|Type|Typ|Ref|SKU|P\\/N)\\.?\\s?:?\\s?)'
          + '[A-Z0-9][A-Z0-9-]{3,}\\b',
        'g',
      ),
    },
    // Bare codes: at least 5 characters, containing a digit (so MAX, WARNING and
    // CAUTION can never match) AND containing an uppercase letter (so a numeric
    // range like "20-25" is not mistaken for an article code and stolen from the
    // measure matcher below).
    {
      type: 'code',
      priority: 5,
      re: /\b(?=[A-Z0-9-]{5,}\b)(?=[A-Z-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]+\b/g,
    },

    // Numeral (optionally a range) plus a symbol unit.
    {
      type: 'measure',
      priority: 6,
      re: new RegExp(
        '(?<![\\p{L}\\p{N}.,])[+-]?\\d+(?:[.,]\\d+)?(?:\\s?-\\s?\\d+(?:[.,]\\d+)?)?\\s?'
          + '(?:' + DEGREE + '?(?:' + UNIT_ALTERNATION + '))(?![\\p{L}\\p{N}])',
        'gu',
      ),
    },

    // Anything numeric left over.
    {
      type: 'num',
      priority: 7,
      re: new RegExp('(?<![\\p{L}\\p{N}._,\\/-])[+-]?\\d+(?:[.,]\\d+)*(?![\\p{L}\\p{N}._,\\/-])', 'gu'),
    },
  );

  return matchers;
};

// ---------------------------------------------------------------------------
// Canonical forms
// ---------------------------------------------------------------------------

const NUM_WITH_UNIT_RE = new RegExp(
  '^([+-]?\\d+(?:[.,]\\d+)?(?:\\s?-\\s?\\d+(?:[.,]\\d+)?)?)\\s?(' + DEGREE + '?.*)$',
);

/** `2,5` and `2.5` are the same number; `.` is the locale-neutral separator. */
const canonicalNumber = (s: string): string => s.replace(/,/g, '.').replace(/\s/g, '');

const canonicalize = (type: PlaceholderType, value: string): Omit<ExtractedPlaceholder, 'index'> => {
  if (type === 'measure') {
    const m = NUM_WITH_UNIT_RE.exec(value);
    const numeric = canonicalNumber(m?.[1] ?? value);
    const unit = (m?.[2] ?? '').trim();
    return { type, value, canonical: numeric + '|' + unit, numeric, unit };
  }
  if (type === 'num' || type === 'xref') {
    const numeric = canonicalNumber(value);
    return { type, value, canonical: numeric, numeric };
  }
  // Identifiers, brands, URLs and dates compare on their literal form with
  // internal whitespace removed, so "EN 60335-1" and "EN60335-1" are one thing.
  return { type, value, canonical: value.replace(/\s+/g, '') };
};

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

interface RawMatch {
  start: number;
  end: number;
  type: PlaceholderType;
  value: string;
  priority: number;
}

const MARKER_RE = /\{\{[^{}]*\}\}/g;

const markerRangesIn = (s: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(s))) out.push([m.index, m.index + m[0].length]);
  return out;
};

const overlaps = (a: number, b: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([x, y]) => a < y && b > x);

const collectMatches = (text: string, brands: string[]): RawMatch[] => {
  const markers = markerRangesIn(text);
  const raw: RawMatch[] = [];

  for (const matcher of buildMatchers(brands)) {
    const re = new RegExp(matcher.re.source, matcher.re.flags);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!overlaps(start, end, markers)) {
        raw.push({ start, end, type: matcher.type, value: m[0], priority: matcher.priority });
      }
    }
  }

  // Resolve overlaps: better priority first, then the longer match, then the
  // earlier one. Deterministic, so a key never depends on matcher iteration luck.
  raw.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.start - b.start;
  });

  const accepted: RawMatch[] = [];
  for (const candidate of raw) {
    const clash = accepted.some((k) => candidate.start < k.end && candidate.end > k.start);
    if (!clash) accepted.push(candidate);
  }

  return accepted.sort((a, b) => a.start - b.start);
};

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

const ORDINAL_SUFFIX_RE = /^(?:st|nd|rd|th|[.]?(?:º|ª)|er|ème|e)\b/i;

/**
 * True when a bare numeral sits next to a letter-word that is not a unit symbol.
 *
 * Deliberately broad. Slavic and several Romance languages select a noun's case
 * and number FROM the numeral's value — Polish needs a different form after 22
 * than after 24 — so a magnitude-based rule ("only 0 and 1 are risky") is simply
 * wrong for exactly the languages that matter most here. Adjacency is the rule.
 */
const numeralAdjacentToWord = (text: string, m: RawMatch): boolean => {
  const before = /([\p{L}]+)\s?$/u.exec(text.slice(Math.max(0, m.start - 24), m.start));
  const after = /^\s?([\p{L}]+)/u.exec(text.slice(m.end, m.end + 24));
  for (const hit of [before, after]) {
    const word = hit?.[1];
    if (word && !UNIT_WORDS.has(word.toLowerCase())) return true;
  }
  return false;
};

const isOrdinal = (text: string, m: RawMatch): boolean => {
  if (ORDINAL_SUFFIX_RE.test(text.slice(m.end))) return true;
  // German-style ordinal: "4. Schritt" — a numeral, a full stop, then a capital.
  return new RegExp('^\\.\\s?\\p{Lu}', 'u').test(text.slice(m.end));
};

const GROUP_SEPARATED_RE = /^[+-]?\d{1,3}(?:[.,]\d{3})+$/;

/** The numeric part of a match, so a measure's number can be safety-checked too. */
const numberPartOf = (type: PlaceholderType, value: string): string => {
  if (type === 'num') return value;
  if (type !== 'measure') return '';
  return NUM_WITH_UNIT_RE.exec(value)?.[1]?.trim() ?? '';
};

/**
 * True when a numeral carries thousands separators, e.g. `1,450` or `1.450`.
 *
 * Such a value is genuinely ambiguous — `1,450` is one thousand four hundred and
 * fifty in English and one point four five in German — so re-injecting it into
 * another locale means swapping BOTH separators correctly. That is an easy place
 * to turn 1450 into 1.45 in a specification table, so these are kept literal.
 * Applies to measures as well as bare numerals: `1,450 W` is the common case.
 */
const isGroupSeparated = (type: PlaceholderType, value: string): boolean =>
  GROUP_SEPARATED_RE.test(numberPartOf(type, value));

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ExtractPlaceholderOptions {
  /**
   * Brand and product names to protect, supplied by the caller from product data.
   * Never guessed: a heuristic that invents brand names would placeholder
   * ordinary capitalized nouns.
   */
  brands?: string[];
}

/**
 * Extract typed placeholders from a segment's normalized key text.
 *
 * Returns the matching form (`patternText`), the re-injectable placeholder list,
 * and the safety verdict. Never throws.
 */
export const extractPlaceholders = (
  normalizedKeyText: string,
  opts: ExtractPlaceholderOptions = {},
): PlaceholderedSegment => {
  const text = normalizedKeyText ?? '';
  const matches = collectMatches(text, opts.brands ?? []);

  const detected: ExtractedPlaceholder[] = matches.map((m, i) => ({
    index: i,
    ...canonicalize(m.type, m.value),
  }));

  const unsafeReasons: PlaceholderUnsafeReason[] = [];
  const addReason = (r: PlaceholderUnsafeReason): void => {
    if (!unsafeReasons.includes(r)) unsafeReasons.push(r);
  };

  if (matches.length > MAX_PLACEHOLDERS) addReason('too_many_placeholders');

  matches.forEach((m) => {
    if (m.type === 'num' && numeralAdjacentToWord(text, m)) addReason('numeral_adjacent_to_word');
    if ((m.type === 'num' || m.type === 'measure') && isOrdinal(text, m)) addReason('ordinal');
    if (isGroupSeparated(m.type, m.value)) addReason('group_separated_number');
    // A sentence-initial value drives capitalization and verb agreement in the
    // target, so it cannot be swapped for a different one.
    if (m.start === 0 && (m.type === 'num' || m.type === 'measure')) {
      addReason('segment_initial_placeholder');
    }
  });

  const placeholderSafe = unsafeReasons.length === 0;

  let patternText = text;
  if (placeholderSafe && matches.length) {
    let out = '';
    let cursor = 0;
    matches.forEach((m, i) => {
      out += text.slice(cursor, m.start) + '{{P' + i + '}}';
      cursor = m.end;
    });
    patternText = out + text.slice(cursor);
  }

  const proseOnly = patternText.replace(MARKER_RE, ' ');
  const translatable = /[\p{L}]{2,}/u.test(proseOnly);

  return {
    patternText,
    placeholders: placeholderSafe ? detected : [],
    detected,
    placeholderSafe,
    unsafeReasons,
    translatable,
  };
};

/** Decimal separator per target language, for re-injecting a `measure` or `num`. */
export const DECIMAL_SEPARATOR: Record<string, '.' | ','> = {
  en: '.',
  ga: '.',
  mt: '.',
  bg: ',', cs: ',', da: ',', de: ',', el: ',', es: ',', et: ',', fi: ',', fr: ',',
  hr: ',', hu: ',', it: ',', lt: ',', lv: ',', nl: ',', pl: ',', pt: ',', ro: ',',
  sk: ',', sl: ',', sv: ',',
};

/**
 * Render a placeholder's value for a target language.
 *
 * Numbers get the target's decimal separator; identifiers, brands, URLs,
 * regulation numbers, dates and cross-references are re-injected VERBATIM.
 * Reformatting an article code or a standard identifier would be a data error,
 * not a localization.
 */
export const renderPlaceholderValue = (p: ExtractedPlaceholder, targetLang: string): string => {
  if (p.type !== 'measure' && p.type !== 'num') return p.value;
  const sep = DECIMAL_SEPARATOR[(targetLang || 'en').toLowerCase().split('-')[0]] ?? ',';
  if (sep === '.') return p.value.replace(/,/g, '.');
  return p.value.replace(/\./g, ',');
};
