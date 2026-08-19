import { describe, it, expect } from 'vitest';
import {
  DECIMAL_SEPARATOR,
  PLACEHOLDER_VERSION,
  extractPlaceholders,
  renderPlaceholderValue,
} from './im-tm-placeholders';

const ex = (s: string, brands?: string[]) => extractPlaceholders(s, { brands });
const typesOf = (s: string, brands?: string[]) => ex(s, brands).detected.map((p) => p.type);
const valuesOf = (s: string, brands?: string[]) => ex(s, brands).detected.map((p) => p.value);

describe('PLACEHOLDER_VERSION', () => {
  it('is 1 — bumping it invalidates every stored key', () => {
    expect(PLACEHOLDER_VERSION).toBe(1);
  });
});

describe('measures', () => {
  it.each([
    ['230 V', '230', 'V'],
    ['50 Hz', '50', 'Hz'],
    ['2.5 l', '2.5', 'l'],
    ['1450 W', '1450', 'W'],
    ['12 kWh', '12', 'kWh'],
    ['500 mAh', '500', 'mAh'],
    ['80 %', '80', '%'],
    ['1400 rpm', '1400', 'rpm'],
  ])('detects %s as a measure', (input, numeric, unit) => {
    const p = ex('Rated at ' + input + ' nominal.').detected[0];
    expect(p.type).toBe('measure');
    expect(p.numeric).toBe(numeric);
    expect(p.unit).toBe(unit);
  });

  it('detects a negative temperature with a degree sign', () => {
    const p = ex('Store above -18 ' + String.fromCharCode(0x00b0) + 'C at all times.').detected[0];
    expect(p.type).toBe('measure');
    expect(p.numeric).toBe('-18');
  });

  it('detects a range as one measure', () => {
    expect(valuesOf('Tighten to between 20-25 Nm of torque.')).toEqual(['20-25 Nm']);
  });

  it('treats a comma decimal and a dot decimal as the same number', () => {
    const dot = ex('Holds 2.5 l of water in total.').detected[0];
    const comma = ex('Holds 2,5 l of water in total.').detected[0];
    expect(dot.canonical).toBe(comma.canonical);
    expect(dot.canonical).toBe('2.5|l');
  });

  it('does not read the English preposition "in" as inches', () => {
    // "in" is deliberately excluded from the unit list — see the module docstring.
    expect(typesOf('Place 5 in the storage compartment.')).not.toContain('measure');
  });

  it('does not treat a spelled-out unit as a measure', () => {
    expect(typesOf('Boil for 3 litres of fresh water.')).not.toContain('measure');
  });
});

describe('identifiers, regulations, links and dates', () => {
  it('detects an EU regulation number', () => {
    expect(valuesOf('Complies with (EU) 2019/2016 fully.')).toEqual(['(EU) 2019/2016']);
    expect(typesOf('Complies with (EU) 2019/2016 fully.')).toEqual(['regnum']);
  });

  it('detects a harmonised standard', () => {
    const r = ex('Tested according to EN 60335-1 by the lab.');
    expect(r.detected[0].type).toBe('regnum');
    expect(r.detected[0].canonical).toBe('EN60335-1');
  });

  it('treats a spaced and unspaced standard identifier as the same thing', () => {
    expect(ex('See EN 60335-1 now.').detected[0].canonical).toBe(
      ex('See EN60335-1 now.').detected[0].canonical,
    );
  });

  it('detects a directive reference', () => {
    expect(typesOf('Under Directive 2014/35/EU this applies.')).toEqual(['regnum']);
  });

  it('detects urls and email addresses', () => {
    expect(typesOf('Register at https://example.test/warranty today.')).toEqual(['url']);
    expect(typesOf('Write to service@example.test for parts.')).toEqual(['url']);
  });

  it('detects iso and european date formats', () => {
    expect(typesOf('Issued on 2024-05-01 by the manufacturer.')).toEqual(['date']);
    expect(typesOf('Issued on 01.05.2024 by the manufacturer.')).toEqual(['date']);
  });

  it('detects a bare article code but never an uppercase word', () => {
    expect(valuesOf('Order part KG350X from your dealer.')).toEqual(['KG350X']);
    expect(ex('Fill to the MAX line carefully.').detected).toHaveLength(0);
    expect(ex('WARNING: risk of electric shock here.').detected).toHaveLength(0);
    expect(ex('CAUTION applies to the hot surface.').detected).toHaveLength(0);
  });

  it('captures only the code after a label, not the label', () => {
    expect(valuesOf('Model KL12345 is affected by this.')).toEqual(['KL12345']);
  });
});

describe('cross-references', () => {
  it('placeholders only the number, leaving the label as translatable prose', () => {
    const r = ex('Refer to Fig. 4 for the wiring layout.');
    expect(r.detected).toHaveLength(1);
    expect(r.detected[0].type).toBe('xref');
    expect(r.detected[0].value).toBe('4');
    expect(r.patternText).toBe('Refer to Fig. {{P0}} for the wiring layout.');
  });

  it('keeps a dotted section reference whole', () => {
    expect(valuesOf('Described in section 4.2 of this manual.')).toEqual(['4.2']);
  });
});

describe('brands', () => {
  it('placeholders only brands the caller supplied', () => {
    expect(valuesOf('The Klarstein unit is earthed.', ['Klarstein'])).toEqual(['Klarstein']);
    expect(ex('The Klarstein unit is earthed.').detected).toHaveLength(0);
  });

  it('matches a brand case-sensitively', () => {
    expect(ex('the klarstein unit is earthed.', ['Klarstein']).detected).toHaveLength(0);
  });
});

describe('never placeholders lexical content', () => {
  it.each([
    'Do not immerse the appliance in water.',
    'Clean the housing with a damp cloth.',
    'Risk of electric shock during maintenance.',
    'Unplug the appliance before cleaning it.',
  ])('leaves %s entirely alone', (s) => {
    const r = ex(s);
    expect(r.detected).toHaveLength(0);
    expect(r.patternText).toBe(s);
    expect(r.placeholderSafe).toBe(true);
  });
});

describe('placeholderSafe', () => {
  it.each([
    ['a numeral counting a noun', 'Wait 2 minutes before opening the lid.', 'numeral_adjacent_to_word'],
    ['a numeral counting an action', 'Repeat 3 times until the light stops.', 'numeral_adjacent_to_word'],
    ['a numeral counting parts', 'Use 24 screws to fasten the bracket.', 'numeral_adjacent_to_word'],
    ['a thousands separator', 'Rated at 1,450 W under full load here.', 'group_separated_number'],
  ])('marks %s as unsafe', (_label, input, reason) => {
    const r = ex(input);
    expect(r.placeholderSafe).toBe(false);
    expect(r.unsafeReasons).toContain(reason);
    expect(r.placeholders).toHaveLength(0);
  });

  it('treats a German ordinal after a reference cue as a safe cross-reference', () => {
    // "Siehe 4. Kapitel" -> "Siehe 5. Kapitel" is valid German: the numeral itself
    // does not inflect, only the surrounding article does, and that is untouched.
    const r = ex('Siehe 4. Kapitel dieser Bedienungsanleitung.');
    expect(r.detected.map((p) => p.type)).toEqual(['xref']);
    expect(r.placeholderSafe).toBe(true);
    expect(r.patternText).toBe('Siehe {{P0}}. Kapitel dieser Bedienungsanleitung.');
  });

  it.each([
    'Before 1st use rinse all removable parts.',
    'Press the 2nd button on the control panel.',
  ])('never placeholders an ordinal numeral at all: %s', (input) => {
    // Ordinals are excluded one step earlier than the safety rule: the bare-numeral
    // matcher refuses any digit run touching a letter or a full stop, so "1st" and
    // "4." are never candidates. That is the outcome that matters — an undetected
    // numeral cannot be wrongly re-injected. The `ordinal` safety reason remains in
    // the module as defence in depth for if that lookahead is ever loosened.
    const r = ex(input);
    expect(r.detected).toHaveLength(0);
    expect(r.patternText).toBe(input);
  });

  it('still reports detected candidates on an unsafe segment', () => {
    // The similarity scorer needs these to cap a match whose numeral differs.
    const r = ex('Wait 2 minutes before opening the lid.');
    expect(r.placeholderSafe).toBe(false);
    expect(r.detected.length).toBeGreaterThan(0);
  });

  it('keeps literals in patternText on an unsafe segment', () => {
    const input = 'Wait 2 minutes before opening the lid.';
    expect(ex(input).patternText).toBe(input);
  });

  it('marks a sentence-initial numeral unsafe', () => {
    const r = ex('230 V is required for this appliance.');
    expect(r.placeholderSafe).toBe(false);
    expect(r.unsafeReasons).toContain('segment_initial_placeholder');
  });

  it('marks more than eight placeholders unsafe', () => {
    const r = ex('Values: 1 V, 2 V, 3 V, 4 V, 5 V, 6 V, 7 V, 8 V, 9 V, 10 V here.');
    expect(r.unsafeReasons).toContain('too_many_placeholders');
  });

  it('treats a measure between symbols as safe', () => {
    const r = ex('Supply: 230 V ~ 50 Hz nominal rating.');
    expect(r.placeholderSafe).toBe(true);
    expect(r.patternText).toBe('Supply: {{P0}} ~ {{P1}} nominal rating.');
  });

  it('treats a parenthesised reference as safe', () => {
    expect(ex('Check the seal (see 4.2) before use.').placeholderSafe).toBe(true);
  });
});

describe('patternText collapses value-only variants', () => {
  it('gives two capacities the same pattern but different values', () => {
    const a = ex('The tank has a capacity of 2.5 l.');
    const b = ex('The tank has a capacity of 3.0 l.');
    expect(a.patternText).toBe(b.patternText);
    expect(a.patternText).toBe('The tank has a capacity of {{P0}}.');
    expect(a.detected[0].canonical).not.toBe(b.detected[0].canonical);
  });

  it('numbers placeholders in document order', () => {
    expect(ex('Set 10 mm then 20 mm and finally 30 mm.').patternText).toBe(
      'Set {{P0}} then {{P1}} and finally {{P2}}.',
    );
  });
});

describe('markers are never touched', () => {
  it('skips chip markers when scanning', () => {
    const r = ex('The {{T0:chip.model_name}} runs at 230 V nominal.');
    expect(r.detected).toHaveLength(1);
    expect(r.patternText).toBe('The {{T0:chip.model_name}} runs at {{P0}} nominal.');
  });

  it('does not placeholder a number inside a marker identity', () => {
    const r = ex('Fitted with {{T0:chip.attr_12345}} as standard equipment.');
    expect(r.detected).toHaveLength(0);
  });
});

describe('translatable', () => {
  it('is false when nothing but data remains', () => {
    expect(ex('230 V').translatable).toBe(false);
    expect(ex('{{T0:img}}').translatable).toBe(false);
  });

  it('is true when real prose remains', () => {
    expect(ex('Rated 230 V nominal.').translatable).toBe(true);
  });
});

describe('renderPlaceholderValue', () => {
  const measure = (value: string) => ex('Holds ' + value + ' of water.').detected[0];

  it('uses a comma decimal separator for continental targets', () => {
    expect(renderPlaceholderValue(measure('2.5 l'), 'de')).toBe('2,5 l');
    expect(renderPlaceholderValue(measure('2.5 l'), 'fr')).toBe('2,5 l');
  });

  it('uses a dot decimal separator for English', () => {
    expect(renderPlaceholderValue(measure('2,5 l'), 'en')).toBe('2.5 l');
  });

  it('falls back to the base language of a full locale code', () => {
    expect(renderPlaceholderValue(measure('2.5 l'), 'de-AT')).toBe('2,5 l');
  });

  it('never reformats an identifier, a regulation number or a url', () => {
    const code = ex('Order part KG350X now.').detected[0];
    const reg = ex('Under (EU) 2019/2016 rules.').detected[0];
    const url = ex('Visit https://example.test/a.b today.').detected[0];
    expect(renderPlaceholderValue(code, 'de')).toBe('KG350X');
    expect(renderPlaceholderValue(reg, 'de')).toBe('(EU) 2019/2016');
    expect(renderPlaceholderValue(url, 'de')).toBe('https://example.test/a.b');
  });

  it('covers every IM language in the separator table', () => {
    expect(Object.keys(DECIMAL_SEPARATOR).length).toBeGreaterThanOrEqual(22);
  });
});
