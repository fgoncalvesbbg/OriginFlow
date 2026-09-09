/**
 * Comparing our stored values against the EPREL registry's own figures.
 *
 * This is the part of the cross-check that earns its keep. Comparing the two naively produces a
 * grid of false alarms — upstream, folding energy-class codifications alone turned **81 false
 * mismatches on one category** into zero — so almost everything here is about deciding when two
 * differently-written values are the same value.
 *
 * Three tolerances, each for a real reason:
 *
 *  1. **Units are stripped.** EPREL answers a measurement as `641.0000 CUBIC_METER_PER_HOUR`
 *     or `641 m³/h`; we store `641` with the unit alongside. Comparing the strings says they
 *     differ. Comparing the numbers says they agree, which is the truth.
 *  2. **Precision is tolerated at the COARSER of the two.** `0.44` and `0.4` are the same
 *     measurement reported to different precision. Insisting on the finer one makes every
 *     rounded registry figure a mismatch.
 *  3. **Class codifications are folded both ways.** The same class arrives as `A++`,
 *     `a_plus_plus`, or EPREL's own shorthand `APP`. All three mean A++.
 *
 * And two refusals:
 *
 *  - **"EPREL has it, we don't" is a separate verdict from "they disagree."** One is a gap to
 *    fill, the other is a value to fix. Reporting them together sends people to the wrong job.
 *  - **No safe equivalent ⇒ offer nothing.** Where the registry's figure cannot be converted
 *    into something the field can actually hold, no suggestion is produced. A wrong pre-filled
 *    value is harder to notice than an absent one.
 *
 * Phase 6 of docs/originflow-attribute-viewer-merge-plan.md. Pure and contract-independent:
 * nothing here knows how EPREL is reached, only how to read what it said.
 */
import type { CategoryAttribute } from '../../../types';

export type EprelVerdict =
  /** Both hold a value and they mean the same thing. */
  | 'agree'
  /** Both hold a value and they genuinely differ. A value to fix. */
  | 'differs'
  /** The registry has a figure and we have nothing. A gap to fill — not a disagreement. */
  | 'only-eprel'
  /** We have a value and the registry has no such field. Nothing to conclude from that. */
  | 'only-ours'
  /** Neither side has anything. */
  | 'no-figure';

export interface EprelComparison {
  attributeId: string;
  /** The EPREL field this attribute maps to (`category_attributes.eprel_id`). */
  eprelField: string;
  ourValue: string | null;
  /** The registry's figure, as it arrived. */
  eprelValue: string | null;
  verdict: EprelVerdict;
  /**
   * A value the FIELD CAN HOLD, derived from the registry's figure — the starting point for
   * "make our record say what EPREL says". Absent when there is no safe equivalent.
   */
  suggestion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// Normalisers
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The numeric part of a measurement, whatever unit is glued to it.
 *
 * Handles both shapes the registry uses: a SCREAMING_SNAKE unit name
 * (`641.0000 CUBIC_METER_PER_HOUR`) and a conventional symbol (`641 m³/h`, `12.5kWh`). Returns
 * `null` when there is no leading number at all, which is how a non-numeric answer in a numeric
 * field stays visible instead of silently becoming 0.
 */
export const numericPart = (raw: string): number | null => {
  const match = raw.trim().replace(',', '.').match(/^[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
};

/** Decimal places a written number carries. `0.44` → 2, `641.0000` → 4, `12` → 0. */
const decimals = (raw: string): number => {
  const match = raw.trim().replace(',', '.').match(/^[+-]?\d+\.(\d+)/);
  return match ? match[1].length : 0;
};

/**
 * Do two written numbers report the same measurement?
 *
 * Compared at the COARSER of the two precisions, so `0.44` agrees with `0.4` but not with
 * `0.5`. Trailing zeros do not count as precision — `641.0000` is a whole number reported
 * verbosely, not a figure known to four decimal places — otherwise the registry's own padding
 * would force every comparison to its widest form.
 */
export const numbersAgree = (a: string, b: string): boolean => {
  const na = numericPart(a);
  const nb = numericPart(b);
  if (na === null || nb === null) return false;
  const significant = (raw: string, value: number) =>
    Number.isInteger(value) ? 0 : decimals(raw);
  const places = Math.min(significant(a, na), significant(b, nb));
  const factor = 10 ** places;
  return Math.round(na * factor) === Math.round(nb * factor);
};

/** Class scale letters an energy label uses. Anything outside this is not a class. */
const CLASS_SHAPE = /^[A-G]\+{0,3}$/;

/**
 * True when an attribute's options are an energy-class scale.
 *
 * Class folding is applied ONLY to these, and that restriction matters: `AP` folds to `A+` on a
 * class scale, but on some other select `AP` could be a legitimate option meaning something
 * else entirely. Deciding from the attribute's own options rather than from the value's shape
 * keeps the tolerance where it belongs.
 */
export const looksLikeClassScale = (attribute: CategoryAttribute): boolean => {
  const options = attribute.validationRules?.enumOptions ?? [];
  return options.length > 0 && options.every(o => CLASS_SHAPE.test(o.trim().toUpperCase()));
};

/**
 * Reduce any of the three class codifications to one canonical form (`A`, `A+`, `A++`, …).
 *
 * Returns `null` for anything that is not a class, so a genuinely odd registry answer is
 * reported rather than coerced into the nearest letter.
 */
export const canonicalClass = (raw: string): string | null => {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (value === '') return null;

  // Spelled out: A_PLUS_PLUS, a-plus-plus, APLUSPLUS
  const spelled = value.replace(/[_-]/g, '');
  const spelledMatch = spelled.match(/^([A-G])(PLUS)+$/);
  if (spelledMatch) {
    const pluses = (spelled.match(/PLUS/g) ?? []).length;
    return `${spelledMatch[1]}${'+'.repeat(pluses)}`;
  }

  // Already canonical: A, A+, A++, A+++
  if (CLASS_SHAPE.test(value)) return value;

  // EPREL's shorthand: AP = A+, APP = A++, APPP = A+++
  const shorthand = value.match(/^([A-G])(P{1,3})$/);
  if (shorthand) return `${shorthand[1]}${'+'.repeat(shorthand[2].length)}`;

  return null;
};

/** Loose text equality: case and surrounding/among whitespace do not make two values differ. */
const textAgree = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

const isNumeric = (attribute: CategoryAttribute): boolean =>
  attribute.dataType === 'integer' || attribute.dataType === 'decimal';

// ─────────────────────────────────────────────────────────────────────────────────────
// The comparison
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * What the field can hold, derived from the registry's figure — or nothing.
 *
 * Every branch is allowed to give up, and giving up is the correct outcome more often than it
 * looks: an unconvertible figure offered as a pre-filled value is a wrong answer somebody
 * accepts without reading.
 */
export const suggestionFrom = (
  attribute: CategoryAttribute,
  eprelValue: string,
): string | undefined => {
  const raw = eprelValue.trim();
  if (raw === '') return undefined;

  if (attribute.dataType === 'enum') {
    const options = attribute.validationRules?.enumOptions ?? [];
    if (looksLikeClassScale(attribute)) {
      const canonical = canonicalClass(raw);
      // Only if the scale actually offers that class. Some scales skip letters — the live
      // lighting-efficiency scale runs A–E then G — so a canonical F has no home there.
      return canonical && options.includes(canonical) ? canonical : undefined;
    }
    // A non-class select: only an exact option match is safe. Anything else would be a guess
    // between candidates, and guessing between candidates is what this module refuses to do.
    return options.find(o => textAgree(o, raw));
  }

  if (isNumeric(attribute)) {
    const n = numericPart(raw);
    if (n === null) return undefined;
    // The unit is dropped: it belongs to the stored value's own unit field, and the number is
    // what the cell holds.
    if (attribute.dataType === 'integer' && !Number.isInteger(n)) return undefined;
    return String(n);
  }

  if (attribute.dataType === 'boolean') {
    const value = raw.toLowerCase();
    if (['true', 'yes', '1'].includes(value)) return 'true';
    if (['false', 'no', '0'].includes(value)) return 'false';
    return undefined;
  }

  if (attribute.dataType === 'image') return undefined;

  return raw;
};

/**
 * Compare one cell against the registry.
 *
 * `ourValue` is `null` for a cell that is empty or explicitly cleared — both mean "we are not
 * asserting a value here", which is what matters against an external source. The cell's own
 * colour still distinguishes them in the grid.
 */
export const compareToEprel = (
  attribute: CategoryAttribute,
  ourValue: string | null,
  eprelValue: string | null,
): EprelComparison => {
  const eprelField = attribute.eprelId ?? '';
  const ours = (ourValue ?? '').trim() === '' ? null : (ourValue as string).trim();
  const theirs = (eprelValue ?? '').trim() === '' ? null : (eprelValue as string).trim();

  const base = { attributeId: attribute.id, eprelField, ourValue: ours, eprelValue: theirs };

  if (ours === null && theirs === null) return { ...base, verdict: 'no-figure' };

  // A gap to fill, NOT a disagreement. Kept apart because the two send people to different work.
  if (ours === null && theirs !== null) {
    return { ...base, verdict: 'only-eprel', suggestion: suggestionFrom(attribute, theirs) };
  }

  if (theirs === null) return { ...base, verdict: 'only-ours' };

  const agrees = looksLikeClassScale(attribute)
    ? (() => {
        const a = canonicalClass(ours as string);
        const b = canonicalClass(theirs);
        // If either side is not a class at all, fall back to text rather than declaring a
        // mismatch on a value the folding simply did not understand.
        return a !== null && b !== null ? a === b : textAgree(ours as string, theirs);
      })()
    : isNumeric(attribute)
      ? numbersAgree(ours as string, theirs)
      : textAgree(ours as string, theirs);

  if (agrees) return { ...base, verdict: 'agree' };
  return { ...base, verdict: 'differs', suggestion: suggestionFrom(attribute, theirs) };
};

/**
 * Compare every attribute that maps to an EPREL field.
 *
 * Attributes with no `eprelId` are skipped entirely rather than reported as unknown: the
 * registry has no opinion about a field nobody mapped, and listing them would bury the twelve
 * that are mapped under eighty-eight that are not.
 */
export const compareRecordToEprel = (
  attributes: readonly CategoryAttribute[],
  ourValues: Map<string, string | null>,
  eprelRecord: Record<string, unknown>,
): EprelComparison[] => {
  const out: EprelComparison[] = [];
  for (const attribute of attributes) {
    const field = attribute.eprelId?.trim();
    if (!field) continue;
    const raw = eprelRecord[field];
    const theirs =
      raw === null || raw === undefined || typeof raw === 'object' ? null : String(raw);
    const comparison = compareToEprel(attribute, ourValues.get(attribute.id) ?? null, theirs);
    // Nothing on either side is not a finding.
    if (comparison.verdict === 'no-figure') continue;
    out.push(comparison);
  }
  return out;
};

/** The verdicts worth drawing attention to on the grid. */
export const isEprelFinding = (verdict: EprelVerdict): boolean =>
  verdict === 'differs' || verdict === 'only-eprel';

/** Counts for the summary strip: how much the registry disagrees with, and how much it could fill. */
export const summariseEprel = (
  comparisons: readonly EprelComparison[],
): { differs: number; onlyEprel: number; agree: number } => ({
  differs: comparisons.filter(c => c.verdict === 'differs').length,
  onlyEprel: comparisons.filter(c => c.verdict === 'only-eprel').length,
  agree: comparisons.filter(c => c.verdict === 'agree').length,
});
