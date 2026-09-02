import { describe, it, expect } from 'vitest';

import {
  appliesToIM,
  normalizeClause,
  parseCarriers,
  parseObligationBlock,
  parseObligationLine,
  toCarrier,
} from './obligation-parse';

// Every `raw` below is a real line copied out of the live `regulations.checklist` column on
// 2026-09-02. The parser exists to migrate exactly these, so it is tested against exactly
// these rather than against invented examples that would all happen to match.

describe('grammar A — clause · carriers — requirement', () => {
  it('splits the three fields', () => {
    const o = parseObligationLine(
      '7.1 · Rating label, Sales packaging, IM, Product — Rated voltage or rated voltage range',
    )!;
    expect(o).toMatchObject({
      clause: '7.1',
      text: 'Rated voltage or rated voltage range',
      carriers: ['Rating label', 'Sales packaging', 'IM', 'Product'],
      optionalCarriers: [],
      parsed: 'carriers',
    });
  });

  it('separates optional carriers from required ones', () => {
    const o = parseObligationLine(
      '4.5.1 · Rating label, Product (optional: Sales packaging, IM) — CE mark (MIN high 5mm)',
    )!;
    expect(o.carriers).toEqual(['Rating label', 'Product']);
    expect(o.optionalCarriers).toEqual(['Sales packaging', 'IM']);
    expect(o.text).toBe('CE mark (MIN high 5mm)');
  });

  it('handles an annex citation with an ampersand', () => {
    const o = parseObligationLine(
      'ANNEX II & III · IM, Product — Standby mode or Off mode < 0.5W',
    )!;
    expect(o.clause).toBe('Annex II & III');
    expect(o.carriers).toEqual(['IM', 'Product']);
  });

  it('normalises ANNEX to Annex without touching numeric citations', () => {
    expect(parseObligationLine('ANNEX IX · IM — WEEE symbol')!.clause).toBe('Annex IX');
    expect(parseObligationLine('7.12.5 · IM — x')!.clause).toBe('7.12.5');
  });

  it('keeps a trailing carriage return out of the text', () => {
    const o = parseObligationLine('7.14 · IM, Product — The markings shall be clearly legible\r')!;
    expect(o.text).toBe('The markings shall be clearly legible');
  });
});

describe('grammar B — clause TAB requirement TAB verbatim', () => {
  it('takes the quoted third field as mandated wording', () => {
    const o = parseObligationLine(
      '7.12.5\tFor Type Y: state cord must be replaced by manufacturer, service agent, or similarly qualified persons to avoid hazard.\t"If the supply cord is damaged, it must be replaced by the manufacturer, its service agent or similarly qualified persons in order to avoid a hazard."',
    )!;
    expect(o.clause).toBe('7.12.5');
    expect(o.text).toContain('For Type Y');
    expect(o.verbatim).toContain('If the supply cord is damaged');
    expect(o.parsed).toBe('tabbed');
  });

  it('does NOT treat a parenthesised remark as mandated wording', () => {
    // This column feeds the translation freeze registry. Storing a disclaimer as text a
    // manual must carry verbatim would be actively harmful, not merely untidy.
    const o = parseObligationLine(
      '7.12.8\tFor water-mains-connected appliances: state max inlet water pressure (Pa), and min if needed for correct operation.\t(No specific verbatim wording; values to be stated in pascals.)',
    )!;
    expect(o.verbatim).toBeUndefined();
    expect(o.text).toContain('max inlet water pressure');
  });

  it('reads a clause qualifier such as "Addition"', () => {
    const o = parseObligationLine('7.12 Addition\t"WARNING: fill with potable water only."')!;
    expect(o.clause).toBe('7.12');
    expect(o.qualifier).toBe('Addition');
  });

  it('uses the wording as the obligation when that is the only field', () => {
    // "7.12 Addition<TAB>\"WARNING: …\"" has no separate requirement description — the
    // mandated sentence IS the obligation.
    const o = parseObligationLine('7.12 Addition\t"WARNING: Connect to potable water supply only."')!;
    expect(o.text).toContain('WARNING: Connect to potable water supply only.');
    expect(o.verbatim).toContain('WARNING: Connect to potable water supply only.');
    // Mandated manual wording, so it belongs on the IM checklist.
    expect(o.carriers).toEqual(['IM']);
  });

  it('handles a four-digit particular-standard clause', () => {
    const o = parseObligationLine('7.2101 Addition\t"To avoid contamination of food, please respect the following instructions: …"')!;
    expect(o.clause).toBe('7.2101');
    expect(o.qualifier).toBe('Addition');
  });

  it('parses a two-field line with no verbatim', () => {
    const o = parseObligationLine(
      '7.14\tUppercase letters in text explaining signal word: min 1.6 mm. Other letters proportionate.',
    )!;
    expect(o.clause).toBe('7.14');
    expect(o.verbatim).toBeUndefined();
    expect(o.text).toContain('min 1.6 mm');
  });
});

describe('fallbacks', () => {
  it('reads a bare "clause requirement" line', () => {
    const o = parseObligationLine('7.9 Flexible induction cooking zones must be marked')!;
    expect(o).toMatchObject({ clause: '7.9', parsed: 'clause-only' });
    expect(o.text).toBe('Flexible induction cooking zones must be marked');
  });

  it('keeps an unrecognised line rather than dropping it', () => {
    // Losing an obligation to a regex is the one outcome this feature exists to prevent.
    const o = parseObligationLine('Check the packaging artwork before sign-off')!;
    expect(o).toMatchObject({ clause: '', parsed: 'none' });
    expect(o.text).toBe('Check the packaging artwork before sign-off');
  });

  it('ignores blank lines', () => {
    expect(parseObligationLine('')).toBeNull();
    expect(parseObligationLine('   \r')).toBeNull();
  });

  it('strips a markdown bullet, matching the old parser', () => {
    expect(parseObligationLine('- 7.1 · IM — Something')!.clause).toBe('7.1');
  });
});

describe('parseCarriers', () => {
  it('maps the live vocabulary onto canonical names', () => {
    expect(parseCarriers('Rating label, Sales packaging, IM, Product').carriers)
      .toEqual(['Rating label', 'Sales packaging', 'IM', 'Product']);
  });

  it('drops tokens it does not recognise rather than guessing', () => {
    // A wrong carrier hides a real obligation from the IM checklist — worse than an
    // unclassified one, which is merely shown.
    expect(parseCarriers('IM, Website, Product').carriers).toEqual(['IM', 'Product']);
  });

  it('never lists a carrier as both required and optional', () => {
    const { carriers, optionalCarriers } = parseCarriers('IM, Product (optional: IM, Sales packaging)');
    expect(carriers).toEqual(['IM', 'Product']);
    expect(optionalCarriers).toEqual(['Sales packaging']);
  });

  it('tolerates the stray bracket seen in the live data', () => {
    expect(toCarrier('IM)')).toBe('IM');
    expect(toCarrier('Product (optional: Sales packaging')).toBeNull();
  });
});

describe('appliesToIM', () => {
  it('includes an obligation carried by the manual', () => {
    expect(appliesToIM({ carriers: ['IM', 'Product'], optionalCarriers: [] })).toBe(true);
  });

  it('includes one where the manual is an optional carrier', () => {
    expect(appliesToIM({ carriers: ['Rating label'], optionalCarriers: ['IM'] })).toBe(true);
  });

  it('excludes a rating-label-only obligation', () => {
    expect(appliesToIM({ carriers: ['Rating label', 'Product'], optionalCarriers: [] })).toBe(false);
  });

  it('INCLUDES an unclassified obligation', () => {
    // Unknown is not "no". An obligation nobody classified is exactly the one nobody has
    // looked at, so hiding it would put the least-reviewed item in the least-visible place.
    expect(appliesToIM({ carriers: [], optionalCarriers: [] })).toBe(true);
  });
});

describe('normalizeClause', () => {
  it('collapses whitespace and tidies the ampersand', () => {
    expect(normalizeClause('ANNEX  II&III')).toBe('Annex II & III');
  });

  it('leaves a numeric citation exactly as written', () => {
    // "7.12" and "7.1.2" are different obligations; a helpful normaliser would merge them.
    expect(normalizeClause('7.12')).toBe('7.12');
    expect(normalizeClause('7.1.2')).toBe('7.1.2');
  });
});

describe('parseObligationBlock', () => {
  it('parses a multi-line checklist and keeps order', () => {
    const out = parseObligationBlock(
      '7.1 · IM — First\n\n7.14 · Rating label — Second\nUnstructured third',
    );
    expect(out.map(o => o.clause)).toEqual(['7.1', '7.14', '']);
    expect(out.map(o => o.parsed)).toEqual(['carriers', 'carriers', 'none']);
  });

  it('returns nothing for an empty checklist', () => {
    expect(parseObligationBlock(null)).toEqual([]);
    expect(parseObligationBlock('')).toEqual([]);
  });
});
