/**
 * Parsing the checklist conventions operators invented, into the structure they were
 * reaching for (migration 141).
 *
 * `regulations.checklist` was one free-text line per obligation. With no field for a clause
 * number or for which artifact carries the obligation, people encoded both INSIDE the line,
 * and converged on two grammars without anyone specifying either:
 *
 *   A.  7.1 · Rating label, Sales packaging, IM, Product — Rated voltage or rated voltage range
 *       <clause> · <carriers> — <requirement>
 *       Carriers may mark some as optional:  Rating label, Product (optional: Sales packaging, IM)
 *
 *   B.  7.12.5<TAB>For Type Y: state cord must be replaced by…<TAB>"If the supply cord is damaged, …"
 *       <clause><TAB><requirement>[<TAB><mandated verbatim wording>]
 *       The clause may carry a qualifier: "7.12 Addition" (Part 2-x adding to Part 1's 7.12).
 *
 * A third field only counts as MANDATED WORDING when it is quoted. The same slot is also used
 * for prose disclaimers — "(No specific verbatim wording; values to be stated in pascals.)" —
 * and storing those as text a manual must contain verbatim would be actively harmful, since
 * this column is the natural feed for the translation freeze registry.
 *
 * WHAT AN UNPARSED LINE MEANS. `carriers: []` is "we do not know", NOT "no artifact carries
 * this". The IM checklist therefore SHOWS an obligation with no carriers rather than hiding
 * it: dropping a real obligation because a line did not match a regex is the one outcome this
 * whole feature exists to prevent. `parsed` says which grammar matched, so the UI can ask a
 * person to classify the leftovers instead of pretending they are complete.
 */

/** The artifacts an obligation can land on. Closed vocabulary — see CARRIER_ALIASES. */
export const CARRIERS = ['IM', 'Product', 'Rating label', 'Sales packaging'] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Everything seen in the live data, lowercased, mapped to the canonical spelling. */
const CARRIER_ALIASES: Record<string, Carrier> = {
  'im': 'IM',
  'instruction manual': 'IM',
  'manual': 'IM',
  'product': 'Product',
  'rating label': 'Rating label',
  'ratinglabel': 'Rating label',
  'label': 'Rating label',
  'sales packaging': 'Sales packaging',
  'packaging': 'Sales packaging',
};

export interface ParsedObligation {
  /** Clause citation as written, whitespace-normalised, e.g. "7.12.5" or "Annex II & III". */
  clause: string;
  /** A qualifier that followed the number, e.g. "Addition". Empty when there was none. */
  qualifier: string;
  /** What must be done. Never empty for a parsed line. */
  text: string;
  /** Wording that must appear verbatim, when the line quoted some. */
  verbatim?: string;
  carriers: Carrier[];
  /** Carriers the line marked "(optional: …)". */
  optionalCarriers: Carrier[];
  /** Which grammar matched — 'none' means only the raw text could be recovered. */
  parsed: 'carriers' | 'tabbed' | 'clause-only' | 'none';
}

/** Collapse whitespace and strip a leading bullet marker, matching parseBulletLines. */
const clean = (s: string): string => s.replace(/^[-*•]\s+/, '').replace(/\s+/g, ' ').trim();

/**
 * Normalise a clause citation. Only whitespace and the ALL-CAPS "ANNEX" spelling are touched
 * — everything else is a citation and must survive byte-for-byte, because "7.12" and "7.1.2"
 * are different obligations and a helpful normaliser would silently merge them.
 */
export const normalizeClause = (raw: string): string =>
  clean(raw).replace(/^ANNEX\b/i, 'Annex').replace(/\s*&\s*/g, ' & ');

/** Split a clause token into its number and any trailing qualifier ("7.12 Addition"). */
const splitClause = (raw: string): { clause: string; qualifier: string } => {
  const t = clean(raw);
  // Annex citations can contain spaces and roman numerals, so they are matched whole first.
  const annex = t.match(/^(Annex\s+[IVXLC]+(?:\s*&\s*[IVXLC]+)*)\s*(.*)$/i);
  if (annex) return { clause: normalizeClause(annex[1]), qualifier: clean(annex[2]) };
  const numbered = t.match(/^(\d+(?:\.\d+)*)\s*(.*)$/);
  if (numbered) return { clause: numbered[1], qualifier: clean(numbered[2]) };
  return { clause: normalizeClause(t), qualifier: '' };
};

/** Map one carrier token onto the closed vocabulary, or null when it is not one. */
export const toCarrier = (token: string): Carrier | null =>
  CARRIER_ALIASES[clean(token).toLowerCase().replace(/[.)]+$/, '')] ?? null;

/**
 * Parse the carriers field: "Rating label, Product (optional: Sales packaging, IM)".
 * Unrecognised tokens are dropped rather than guessed at — a wrong carrier would hide a real
 * obligation from the IM checklist, which is worse than showing an unclassified one.
 */
export const parseCarriers = (
  field: string,
): { carriers: Carrier[]; optionalCarriers: Carrier[] } => {
  const optionalMatch = field.match(/\(\s*optional\s*:\s*([^)]*)\)/i);
  const optionalRaw = optionalMatch?.[1] ?? '';
  const requiredRaw = field.replace(/\(\s*optional\s*:[^)]*\)/i, '');

  const collect = (s: string): Carrier[] => {
    const out: Carrier[] = [];
    for (const token of s.split(/[,;/]/)) {
      const carrier = toCarrier(token);
      if (carrier && !out.includes(carrier)) out.push(carrier);
    }
    return out;
  };

  const carriers = collect(requiredRaw);
  const optionalCarriers = collect(optionalRaw).filter(c => !carriers.includes(c));
  return { carriers, optionalCarriers };
};

/** True when a field is a quoted string, i.e. mandated wording rather than a remark. */
const quotedText = (field: string): string | undefined => {
  const t = field.trim();
  if (!t) return undefined;
  // Straight or curly quotes; the live data uses both. A field opening with "(" is a remark
  // like "(No specific verbatim wording; …)" and must NOT become text a manual must carry.
  if (!/^["“]/.test(t)) return undefined;
  return t.replace(/\s+/g, ' ').trim();
};

/**
 * Parse one checklist line. Never throws and never returns null: a line that matches nothing
 * still comes back with its text intact and `parsed: 'none'`, because losing an obligation to
 * a regex is not an acceptable outcome.
 */
export const parseObligationLine = (line: string): ParsedObligation | null => {
  const raw = line.replace(/\r/g, '').replace(/^[-*•]\s+/, '').trim();
  if (!raw) return null;

  // --- Grammar A: clause · carriers — requirement -------------------------
  if (raw.includes(' · ')) {
    const [clausePart, rest] = [raw.slice(0, raw.indexOf(' · ')), raw.slice(raw.indexOf(' · ') + 3)];
    // The em dash separates carriers from the requirement. An en dash and a hyphen-with-spaces
    // both appear in hand-typed lines, so all three are accepted.
    const sep = rest.search(/\s+[—–]\s+|\s+-\s+/);
    const { clause, qualifier } = splitClause(clausePart);
    if (sep >= 0) {
      const carrierField = rest.slice(0, sep);
      const text = clean(rest.slice(sep).replace(/^\s*[—–-]\s*/, ''));
      const { carriers, optionalCarriers } = parseCarriers(carrierField);
      if (text) return { clause, qualifier, text, carriers, optionalCarriers, parsed: 'carriers' };
    }
    // A "·" with no requirement after it — keep the whole remainder as the obligation.
    const text = clean(rest);
    if (text) return { clause, qualifier, text, carriers: [], optionalCarriers: [], parsed: 'clause-only' };
  }

  // --- Grammar B: clause <TAB> requirement [<TAB> verbatim] ---------------
  if (raw.includes('\t')) {
    const fields = raw.split('\t').map(f => f.trim()).filter(f => f !== '');
    if (fields.length >= 2) {
      const { clause, qualifier } = splitClause(fields[0]);
      const second = fields[1];
      const third = fields.slice(2).join(' ');
      const verbatimFromThird = quotedText(third);
      const verbatimFromSecond = quotedText(second);

      // "7.12 Addition<TAB>\"WARNING: fill with potable water only.\"" — the only field IS the
      // mandated wording, so it serves as both the obligation and the verbatim.
      if (fields.length === 2 && verbatimFromSecond) {
        return {
          clause, qualifier, text: clean(second), verbatim: verbatimFromSecond,
          carriers: ['IM'], optionalCarriers: [], parsed: 'tabbed',
        };
      }
      const text = clean(second);
      if (text) {
        return {
          clause, qualifier, text,
          ...(verbatimFromThird ? { verbatim: verbatimFromThird } : {}),
          carriers: [], optionalCarriers: [], parsed: 'tabbed',
        };
      }
    }
  }

  // --- Bare "7.14 Some requirement" ---------------------------------------
  const bare = raw.match(/^((?:Annex\s+[IVXLC]+(?:\s*&\s*[IVXLC]+)*)|\d+(?:\.\d+)*)\s+(.+)$/i);
  if (bare) {
    const { clause, qualifier } = splitClause(bare[1]);
    return {
      clause, qualifier, text: clean(bare[2]),
      carriers: [], optionalCarriers: [], parsed: 'clause-only',
    };
  }

  // Nothing matched. The obligation survives with no clause — visible, and flagged for a
  // person to classify.
  return { clause: '', qualifier: '', text: clean(raw), carriers: [], optionalCarriers: [], parsed: 'none' };
};

/** Parse a whole `regulations.checklist` blob, dropping blank lines. */
export const parseObligationBlock = (checklist: string | null | undefined): ParsedObligation[] =>
  (checklist ?? '')
    .split(/\r?\n/)
    .map(parseObligationLine)
    .filter((o): o is ParsedObligation => o !== null);

/**
 * Whether an obligation belongs on a manual's checklist.
 *
 * Unknown carriers count as "show it". An obligation whose line never got classified is
 * exactly the one nobody has looked at, so hiding it from the pre-publish review would put
 * the least-reviewed items in the least-visible place.
 */
export const appliesToIM = (o: Pick<ParsedObligation, 'carriers' | 'optionalCarriers'>): boolean =>
  o.carriers.length === 0
    ? true
    : o.carriers.includes('IM') || o.optionalCarriers.includes('IM');
