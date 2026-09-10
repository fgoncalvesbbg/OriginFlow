import { describe, it, expect } from 'vitest';

import {
  classifyRegulation,
  groupRegulations,
  KIND_ORDER,
  type RegulationKind,
} from './regulation-grouping';
import type { Regulation } from '../../types';

/** Only the fields the grouping reads; the rest of Regulation is irrelevant here. */
const reg = (referenceCode: string, extra: Partial<Regulation> = {}): Regulation => ({
  id: referenceCode,
  title: '',
  referenceCode,
  jurisdiction: 'EU',
  status: 'active',
  applicableCategories: [],
  summaryBytes: 0,
  ...extra,
} as Regulation);

describe('classifyRegulation', () => {
  // Every code below is a real row from the live library on 2026-09-10.
  const cases: Array<[string, RegulationKind]> = [
    ['Directive 2014/53/EU', 'directive'],
    ['Directive 2012/19/EU WEEE', 'directive'],
    ['Regulation (EU) 2023/826', 'euAct'],
    ['Regulation (EU) No 66/2014', 'euAct'],
    ['Delegated Regulation (EU) 2022/30', 'euAct'],
    ['(EU) 2025/138', 'euAct'],
    ['EN 60529', 'standard'],
    ['EN IEC 60335-1:2021', 'standard'],
    ['EN 60335-1:2012+A11+A13+A1+A14+A2+A15:2021', 'standard'],
    ['EN 18031-1', 'standard'],
    ['IEC 60335-2-30 - Chapter 7', 'standard'],
    ['UN 38.3', 'international'],
    ['Blue Guide 2022', 'guidance'],
    ['UKCA marking guidance', 'guidance'],
  ];

  it.each(cases)('files %s as %s', (code, kind) => {
    expect(classifyRegulation(reg(code))).toBe(kind);
  });

  it('files EN60335-2-24 as a standard despite the missing space after EN', () => {
    // This row really is written without the space, which a /^EN\s/ pattern would miss.
    expect(classifyRegulation(reg('EN60335-2-24 Chapter 7'))).toBe('standard');
  });

  it('classifies from the reference code, never the title', () => {
    // (EU) 2025/138's real title names a Directive AND says "harmonised standards", so a
    // title-sniffing classifier files it as one of those two. It is neither.
    const decision = reg('(EU) 2025/138', {
      title: '(EU) 2025/138 — harmonised standards for radio equipment in support of the '
        + 'Directive 2014/53/EU essential requirements of Article 3(3)(d), (e) and (f)',
    });
    expect(classifyRegulation(decision)).toBe('euAct');
  });

  it('does not let "Regulation" inside a longer code beat the standard test', () => {
    expect(classifyRegulation(reg('EN 12345 Regulation companion'))).toBe('standard');
  });

  it('falls back to national law for a non-EU jurisdiction the code does not describe', () => {
    expect(classifyRegulation(reg('LFGB (BfR §30, §31)', { jurisdiction: 'DE' }))).toBe('national');
  });

  it('is "other" — not a guess — when neither the code nor the jurisdiction says anything', () => {
    expect(classifyRegulation(reg('internal-policy-7', { jurisdiction: 'EU' }))).toBe('other');
    expect(classifyRegulation(reg('', { jurisdiction: '' }))).toBe('other');
  });
});

describe('groupRegulations', () => {
  it('returns sections in KIND_ORDER, not insertion or alphabetical order', () => {
    const groups = groupRegulations(
      [reg('Blue Guide 2022'), reg('EN 60529'), reg('Directive 2014/53/EU')],
      'kind',
    );
    expect(groups.map(g => g.key)).toEqual(['directive', 'standard', 'guidance']);
    // ...which is the declared order, filtered to what is present.
    const present = KIND_ORDER.filter(k => ['directive', 'standard', 'guidance'].includes(k));
    expect(groups.map(g => g.key)).toEqual(present);
  });

  it('omits empty sections rather than rendering a header over nothing', () => {
    const groups = groupRegulations([reg('EN 60529')], 'kind');
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('standard');
  });

  it('preserves the incoming order inside a section', () => {
    // The library query sorts by reference code; grouping must not reshuffle within a group.
    const groups = groupRegulations(
      [reg('EN 18031-1'), reg('EN 18031-2'), reg('EN 60529')],
      'kind',
    );
    expect(groups[0].regulations.map(r => r.referenceCode))
      .toEqual(['EN 18031-1', 'EN 18031-2', 'EN 60529']);
  });

  it('keeps every regulation exactly once, whatever the dimension', () => {
    const library = [
      reg('Directive 2014/53/EU'), reg('Regulation (EU) 2023/826'), reg('EN 60529'),
      reg('UN 38.3', { jurisdiction: 'UN' }), reg('LFGB (BfR §30, §31)', { jurisdiction: 'DE' }),
      reg('Blue Guide 2022'), reg('EN60335-2-24 Chapter 7', { jurisdiction: '' }),
    ];
    for (const dimension of ['kind', 'jurisdiction', 'status', 'none'] as const) {
      const flat = groupRegulations(library, dimension).flatMap(g => g.regulations);
      expect(flat).toHaveLength(library.length);
      expect(new Set(flat.map(r => r.id)).size).toBe(library.length);
    }
  });

  it('leads the jurisdiction sections with EU and parks the blanks at the end', () => {
    const groups = groupRegulations([
      reg('UN 38.3', { jurisdiction: 'UN' }),
      reg('EN60335-2-24 Chapter 7', { jurisdiction: '' }),
      reg('UKCA marking guidance', { jurisdiction: 'UK' }),
      reg('Directive 2014/53/EU', { jurisdiction: 'EU' }),
      reg('LFGB (BfR §30, §31)', { jurisdiction: 'DE' }),
    ], 'jurisdiction');
    expect(groups.map(g => g.label))
      .toEqual(['EU', 'DE', 'UK', 'UN', 'No jurisdiction recorded']);
  });

  it('normalises jurisdiction case so "eu" and "EU" are one section', () => {
    const groups = groupRegulations(
      [reg('Directive 1/1', { jurisdiction: 'eu' }), reg('Directive 2/2', { jurisdiction: 'EU' })],
      'jurisdiction',
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].regulations).toHaveLength(2);
  });

  it('orders status sections active → expired → superseded', () => {
    const groups = groupRegulations([
      reg('A/1', { status: 'superseded' }),
      reg('B/2', { status: 'active' }),
      reg('C/3', { status: 'expired' }),
    ], 'status');
    expect(groups.map(g => g.label)).toEqual(['Active', 'Expired', 'Superseded']);
  });

  it('collapses to a single section when grouping is off', () => {
    const groups = groupRegulations([reg('EN 60529'), reg('Directive 2014/53/EU')], 'none');
    expect(groups).toHaveLength(1);
    expect(groups[0].regulations).toHaveLength(2);
  });

  it('returns no sections for an empty library, in every mode', () => {
    for (const dimension of ['kind', 'jurisdiction', 'status', 'none'] as const) {
      expect(groupRegulations([], dimension)).toEqual([]);
    }
  });
});
