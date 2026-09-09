import { describe, it, expect } from 'vitest';
import {
  numericPart,
  numbersAgree,
  looksLikeClassScale,
  canonicalClass,
  suggestionFrom,
  compareToEprel,
  compareRecordToEprel,
  isEprelFinding,
  summariseEprel,
} from './eprel-compare.utils';
import type { CategoryAttribute } from '../../../types';

const attr = (o: Partial<CategoryAttribute> & { id: string }): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: o.id,
  dataType: 'text',
  ...o,
});

const TEXT = attr({ id: 't' });
const DECIMAL = attr({ id: 'd', dataType: 'decimal' });
const INTEGER = attr({ id: 'i', dataType: 'integer' });
const BOOLEAN = attr({ id: 'b', dataType: 'boolean' });
const IMAGE = attr({ id: 'img', dataType: 'image' });

// A full energy-label scale: every letter A-G plus the plus-tiers.
const CLASS_ENUM = attr({
  id: 'ce',
  dataType: 'enum',
  validationRules: { enumOptions: ['A', 'A+', 'A++', 'A+++', 'B', 'C', 'D', 'E', 'F', 'G'] },
});

// A real-world scale that skips a letter (the live lighting-efficiency scale runs A-E then G),
// so a canonical F has no home here even though it is a well-formed class.
const CLASS_ENUM_SKIPS_F = attr({
  id: 'ces',
  dataType: 'enum',
  validationRules: { enumOptions: ['A', 'B', 'C', 'D', 'E', 'G'] },
});

// A select whose options merely look like short codes, not a class scale.
const NONCLASS_ENUM = attr({
  id: 'ne',
  dataType: 'enum',
  validationRules: { enumOptions: ['Knob', 'Digital'] },
});

// ---------------------------------------------------------------------------
// numericPart — pulling the measurement out of whatever unit is glued to it
// ---------------------------------------------------------------------------

describe('numericPart', () => {
  it('strips a SCREAMING_SNAKE unit name', () => {
    expect(numericPart('641.0000 CUBIC_METER_PER_HOUR')).toBe(641);
  });

  it('strips a conventional unit symbol with a space', () => {
    expect(numericPart('641 m³/h')).toBe(641);
  });

  it('strips a unit symbol glued directly to the number', () => {
    expect(numericPart('12.5kWh')).toBe(12.5);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(numericPart('1,5')).toBe(1.5);
  });

  it('keeps a leading sign', () => {
    expect(numericPart('-5')).toBe(-5);
  });

  it('returns null for a non-numeric answer, so it stays visible instead of becoming 0', () => {
    expect(numericPart('about forty')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(numericPart('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// numbersAgree — same measurement, different precision or unit dressing
// ---------------------------------------------------------------------------

describe('numbersAgree', () => {
  it('agrees at the coarser precision', () => {
    expect(numbersAgree('0.44', '0.4')).toBe(true);
  });

  it('does not agree once the coarser digit itself differs', () => {
    expect(numbersAgree('0.44', '0.5')).toBe(false);
  });

  it('does not count trailing zeros as precision', () => {
    // 641.0000 is a whole number reported verbosely, not a figure known to four decimal
    // places — otherwise every registry figure padded with zeros would force the comparison
    // to its widest form and reject a plain "641".
    expect(numbersAgree('641.0000', '641')).toBe(true);
  });

  it('agrees once the unit is stripped from the registry figure', () => {
    expect(numbersAgree('641.0000 CUBIC_METER_PER_HOUR', '641')).toBe(true);
  });

  it('rejects genuinely different whole numbers', () => {
    expect(numbersAgree('12', '13')).toBe(false);
  });

  it('is false when either side is not numeric at all', () => {
    expect(numbersAgree('about forty', '5')).toBe(false);
    expect(numbersAgree('5', 'about forty')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// looksLikeClassScale — deciding from the attribute's own options, not the value's shape
// ---------------------------------------------------------------------------

describe('looksLikeClassScale', () => {
  it('is true for a full A-G plus-tier scale', () => {
    expect(looksLikeClassScale(CLASS_ENUM)).toBe(true);
  });

  it('is true for a scale that skips some letters, as long as every option is class-shaped', () => {
    expect(looksLikeClassScale(CLASS_ENUM_SKIPS_F)).toBe(true);
  });

  it('is false for options that merely look like short codes', () => {
    expect(looksLikeClassScale(NONCLASS_ENUM)).toBe(false);
  });

  it('is false when there are no options at all', () => {
    expect(looksLikeClassScale(attr({ id: 'empty', dataType: 'enum' }))).toBe(false);
    expect(
      looksLikeClassScale(attr({ id: 'empty2', dataType: 'enum', validationRules: { enumOptions: [] } })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canonicalClass — folding all three codifications to one shape
// ---------------------------------------------------------------------------

describe('canonicalClass', () => {
  it('leaves an already-canonical class alone', () => {
    expect(canonicalClass('A++')).toBe('A++');
  });

  it('folds EPREL shorthand APP to A++', () => {
    expect(canonicalClass('APP')).toBe('A++');
  });

  it('folds EPREL shorthand AP to A+', () => {
    expect(canonicalClass('AP')).toBe('A+');
  });

  it('folds EPREL shorthand APPP to A+++', () => {
    expect(canonicalClass('APPP')).toBe('A+++');
  });

  it('folds the spelled-out form with underscores', () => {
    expect(canonicalClass('a_plus_plus')).toBe('A++');
  });

  it('folds a single spelled-out plus', () => {
    expect(canonicalClass('A_PLUS')).toBe('A+');
  });

  it('folds the spelled-out form with hyphens', () => {
    expect(canonicalClass('a-plus-plus')).toBe('A++');
  });

  it('leaves a plain letter class alone', () => {
    expect(canonicalClass('B')).toBe('B');
  });

  it('returns null for something that is not a class at all', () => {
    expect(canonicalClass('Knob')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(canonicalClass('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(canonicalClass('app')).toBe('A++');
    expect(canonicalClass('b')).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// suggestionFrom — what the field can hold, or nothing
// ---------------------------------------------------------------------------

describe('suggestionFrom', () => {
  it('on a class-scale enum, suggests the canonical class when the scale offers it', () => {
    expect(suggestionFrom(CLASS_ENUM, 'APP')).toBe('A++');
  });

  it('on a class-scale enum, suggests nothing when no safe equivalent exists on the scale', () => {
    // F is a perfectly well-formed class, but this particular scale skips it — a wrong
    // pre-filled value here is harder to notice than an absent one.
    expect(suggestionFrom(CLASS_ENUM_SKIPS_F, 'F')).toBeUndefined();
  });

  it('on a non-class enum, suggests the option on an exact case-insensitive match', () => {
    expect(suggestionFrom(NONCLASS_ENUM, 'digital')).toBe('Digital');
  });

  it('on a non-class enum, suggests nothing rather than guessing between candidates', () => {
    expect(suggestionFrom(NONCLASS_ENUM, 'Analog')).toBeUndefined();
  });

  it('on a decimal, drops the unit and keeps the number', () => {
    expect(suggestionFrom(DECIMAL, '641.0000 CUBIC_METER_PER_HOUR')).toBe('641');
  });

  it('on an integer, suggests nothing for a fractional registry value', () => {
    expect(suggestionFrom(INTEGER, '12.5')).toBeUndefined();
  });

  it('on an integer, suggests the whole number with its unit dropped', () => {
    expect(suggestionFrom(INTEGER, '12 dB')).toBe('12');
  });

  it('on a boolean, folds every truthy spelling to "true"', () => {
    expect(suggestionFrom(BOOLEAN, 'yes')).toBe('true');
    expect(suggestionFrom(BOOLEAN, 'true')).toBe('true');
    expect(suggestionFrom(BOOLEAN, '1')).toBe('true');
  });

  it('on a boolean, folds every falsy spelling to "false"', () => {
    expect(suggestionFrom(BOOLEAN, 'no')).toBe('false');
    expect(suggestionFrom(BOOLEAN, 'false')).toBe('false');
    expect(suggestionFrom(BOOLEAN, '0')).toBe('false');
  });

  it('on a boolean, suggests nothing for anything else', () => {
    expect(suggestionFrom(BOOLEAN, 'maybe')).toBeUndefined();
  });

  it('on text, returns the raw value trimmed', () => {
    expect(suggestionFrom(TEXT, '  Stainless Steel  ')).toBe('Stainless Steel');
  });

  it('on an image attribute, never suggests anything', () => {
    expect(suggestionFrom(IMAGE, 'https://example.com/a.png')).toBeUndefined();
  });

  it('suggests nothing for an empty EPREL value', () => {
    expect(suggestionFrom(TEXT, '')).toBeUndefined();
    expect(suggestionFrom(TEXT, '   ')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// compareToEprel — the verdict for one cell
// ---------------------------------------------------------------------------

describe('compareToEprel', () => {
  it('is "no-figure" when neither side has anything', () => {
    expect(compareToEprel(TEXT, null, null).verdict).toBe('no-figure');
  });

  it('is "only-ours" when we have a value and the registry has none', () => {
    expect(compareToEprel(TEXT, 'x', null).verdict).toBe('only-ours');
  });

  it('is "only-eprel" with a suggestion when the registry has a figure and we have nothing', () => {
    // This is a gap to fill, NOT a disagreement — there is nothing on our side to be wrong.
    // Reporting it as "differs" would send someone to fix a value that does not exist.
    const result = compareToEprel(TEXT, null, 'Stainless Steel');
    expect(result.verdict).toBe('only-eprel');
    expect(result.suggestion).toBe('Stainless Steel');
  });

  it('treats a cleared value (empty string) the same as null', () => {
    expect(compareToEprel(TEXT, '   ', 'Stainless Steel').verdict).toBe('only-eprel');
  });

  it('agrees on numbers within the coarser precision', () => {
    expect(compareToEprel(DECIMAL, '0.44', '0.4').verdict).toBe('agree');
  });

  it('agrees when class codifications fold to the same class', () => {
    expect(compareToEprel(CLASS_ENUM, 'A++', 'APP').verdict).toBe('agree');
  });

  it('differs on genuinely different classes, and offers the folded suggestion', () => {
    const result = compareToEprel(CLASS_ENUM, 'A', 'APP');
    expect(result.verdict).toBe('differs');
    expect(result.suggestion).toBe('A++');
  });

  it('on a class-scale attribute, falls back to text comparison when a side is not a class at all', () => {
    // Neither string is a recognised class, so folding gives up on both — the comparison must
    // still reach a real answer via text rather than silently declaring a mismatch it did not
    // understand.
    expect(compareToEprel(CLASS_ENUM, 'Not Applicable', 'NOT APPLICABLE').verdict).toBe('agree');
    expect(compareToEprel(CLASS_ENUM, 'Foo', 'Bar').verdict).toBe('differs');
  });

  it('agrees on text differing only in case and whitespace', () => {
    expect(compareToEprel(TEXT, 'Stainless  Steel', 'stainless steel').verdict).toBe('agree');
  });
});

// ---------------------------------------------------------------------------
// compareRecordToEprel — running the whole category against one registry record
// ---------------------------------------------------------------------------

describe('compareRecordToEprel', () => {
  it('skips attributes with no eprelId entirely, rather than reporting them as unknown', () => {
    const noMapping = attr({ id: 'unmapped' }); // no eprelId at all
    const result = compareRecordToEprel(
      [noMapping],
      new Map([['unmapped', 'x']]),
      { unmapped: 'y' },
    );
    expect(result).toEqual([]);
  });

  it('omits "no-figure" results from the list', () => {
    const mapped = attr({ id: 'mapped', eprelId: 'field1' });
    const result = compareRecordToEprel([mapped], new Map(), {});
    expect(result).toEqual([]);
  });

  it('reads the value from the record by the attribute\'s own eprelId, not its id or name', () => {
    const mapped = attr({
      id: 'attr-1',
      dataType: 'enum',
      eprelId: 'energy_class_eprel',
      validationRules: { enumOptions: ['A', 'A+', 'A++'] },
    });
    const record = { 'energy_class_eprel': 'APP', 'attr-1': 'WRONG' };
    const [result] = compareRecordToEprel([mapped], new Map(), record);
    expect(result.eprelValue).toBe('APP');
  });

  it('treats a nested object value in the record as null, not comparable', () => {
    const mapped = attr({ id: 'mapped', eprelId: 'field1' });
    const record = { field1: { some: 'object' } };
    const [result] = compareRecordToEprel([mapped], new Map([['mapped', 'ours']]), record);
    // Ours is set and the registry field could not be read as a value, so this is "only-ours" —
    // proof the object was folded to null rather than stringified into a bogus comparison.
    expect(result.verdict).toBe('only-ours');
    expect(result.eprelValue).toBeNull();
  });

  it('treats a numeric 0 in the record as a real value, not as absent', () => {
    const mapped = attr({ id: 'mapped', dataType: 'integer', eprelId: 'field1' });
    const [result] = compareRecordToEprel([mapped], new Map(), { field1: 0 });
    expect(result.verdict).toBe('only-eprel');
    expect(result.eprelValue).toBe('0');
    expect(result.suggestion).toBe('0');
  });

  it('treats a boolean false in the record as a real value, not as absent', () => {
    const mapped = attr({ id: 'mapped', dataType: 'boolean', eprelId: 'field1' });
    const [result] = compareRecordToEprel([mapped], new Map(), { field1: false });
    expect(result.verdict).toBe('only-eprel');
    expect(result.eprelValue).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// isEprelFinding / summariseEprel — what the grid draws attention to
// ---------------------------------------------------------------------------

describe('isEprelFinding', () => {
  it('is a finding when the registry disagrees or fills a gap', () => {
    expect(isEprelFinding('differs')).toBe(true);
    expect(isEprelFinding('only-eprel')).toBe(true);
  });

  it('is not a finding otherwise', () => {
    expect(isEprelFinding('agree')).toBe(false);
    expect(isEprelFinding('only-ours')).toBe(false);
    expect(isEprelFinding('no-figure')).toBe(false);
  });
});

describe('summariseEprel', () => {
  it('counts differs, onlyEprel and agree, ignoring only-ours', () => {
    const comparisons = [
      { attributeId: 'a', eprelField: 'f', ourValue: 'x', eprelValue: 'y', verdict: 'differs' as const },
      { attributeId: 'b', eprelField: 'f', ourValue: null, eprelValue: 'y', verdict: 'only-eprel' as const },
      { attributeId: 'c', eprelField: 'f', ourValue: 'x', eprelValue: 'x', verdict: 'agree' as const },
      { attributeId: 'd', eprelField: 'f', ourValue: 'x', eprelValue: null, verdict: 'only-ours' as const },
    ];
    expect(summariseEprel(comparisons)).toEqual({ differs: 1, onlyEprel: 1, agree: 1 });
  });

  it('is all zeroes for an empty list', () => {
    expect(summariseEprel([])).toEqual({ differs: 0, onlyEprel: 0, agree: 0 });
  });
});
