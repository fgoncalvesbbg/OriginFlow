/**
 * CELEX derivation — turning a citation an operator typed into the identifier EUR-Lex
 * can actually be queried with.
 *
 * A CELEX for a legal act is `3` + 4-digit year + a one-letter type + a 4-digit number:
 *   Directive 2014/35/EU        -> 32014L0035
 *   Regulation (EU) 2023/826    -> 32023R0826
 *   Regulation (EU) No 66/2014  -> 32014R0066    <- note the REVERSED number/year
 *   Regulation (EC) No 1907/2006-> 32006R1907
 *
 * The reversal is the whole reason this is a function and not a regex at the call site.
 * Acts adopted before 2015 are cited "No <number>/<year>"; from 2015 the numbering was
 * unified to "<year>/<number>". Reading the pair positionally gets 32014R0066 wrong half
 * the time, so the year is identified by VALUE (a 4-digit number in a plausible range) and
 * the other half is the sequential number, whichever side it sits on.
 *
 * This is a SUGGESTION, never a silent fact. Every derived CELEX is offered to the operator
 * to confirm on the regulation, and `regulations.celex_id` stores what they accepted — a
 * wrong CELEX would make the version check report confidently on the wrong law.
 *
 * Standards (EN, IEC, ISO, EN IEC 60335-1:2021) have NO CELEX. `deriveCelex` returns null
 * for them on purpose: CENELEC and IEC publish no free catalogue API, so those rows are
 * version-tracked by `source_url` + `review_due_at` and a person.
 */

/** The lowest year we will believe in a citation. Below this it is a sequential number. */
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

/** Directive -> L, Regulation -> R, Decision -> D. */
export type CelexActType = 'L' | 'R' | 'D';

export interface DerivedCelex {
  celex: string;
  actType: CelexActType;
  year: number;
  number: number;
}

const ACT_PATTERNS: Array<{ re: RegExp; type: CelexActType }> = [
  { re: /\bdirective\b/i, type: 'L' },
  { re: /\bregulation\b/i, type: 'R' },
  { re: /\bdecision\b/i, type: 'D' },
];

const isYear = (n: number) => n >= MIN_YEAR && n <= MAX_YEAR;

/**
 * Derive a CELEX from a citation, or null when the text is not an EU legal act.
 *
 * Recognises the act type from the word "Directive"/"Regulation"/"Decision" anywhere in the
 * string, so both `"Directive 2014/35/EU"` and `"EMC Directive 2014/30/EU"` work — the TCF's
 * free-text reference codes are full of the latter shape.
 */
export const deriveCelex = (reference: string | null | undefined): DerivedCelex | null => {
  const text = (reference ?? '').trim();
  if (!text) return null;

  // An EN/IEC/ISO standard number can contain a "/" too (EN 60335-2-24), and would
  // otherwise be misread as a year/number pair. No act word, no CELEX.
  const act = ACT_PATTERNS.find(p => p.re.test(text));
  if (!act) return null;

  // The first bare `<digits>/<digits>` pair. Trailing "/EU", "/EC", "/EEC" is the legal
  // basis suffix, not a third number, so the pair is matched without consuming it.
  const pair = text.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if (!pair) return null;

  const a = Number(pair[1]);
  const b = Number(pair[2]);

  // Identify the year by value, never by position — see the file header.
  let year: number;
  let number: number;
  if (isYear(a) && !isYear(b)) { year = a; number = b; }
  else if (isYear(b) && !isYear(a)) { year = b; number = a; }
  else if (isYear(a) && isYear(b)) {
    // Both plausible years, e.g. "1907/2006" (REACH). The "No <n>/<year>" form always
    // carries the word "No", so that settles it; otherwise the modern year-first form wins.
    if (/\bno\.?\s*\d/i.test(text)) { year = b; number = a; }
    else { year = a; number = b; }
  } else return null;

  if (number < 1 || number > 9999) return null;

  return {
    celex: `3${String(year).padStart(4, '0')}${act.type}${String(number).padStart(4, '0')}`,
    actType: act.type,
    year,
    number,
  };
};

/** The public EUR-Lex page for a CELEX — what the operator clicks through to verify. */
export const eurLexUrl = (celex: string): string =>
  `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;

/** A CELEX as typed by a person: sector digit, year, act letter, number. */
export const isValidCelex = (value: string | null | undefined): boolean =>
  /^[0-9][0-9]{4}[A-Z]{1,2}[0-9]{4}(\([0-9]{2}\))?$/.test((value ?? '').trim().toUpperCase());

/**
 * A consolidated CELEX ("02014L0035-20260530") carries the consolidation date in its
 * suffix. Pulling it out is how the version check gets a comparable date without a second
 * query. Returns null for a base CELEX, which has no suffix.
 */
export const consolidatedDate = (celex: string | null | undefined): string | null => {
  const m = (celex ?? '').match(/-(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
