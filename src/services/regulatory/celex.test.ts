import { describe, it, expect } from 'vitest';

import { consolidatedDate, deriveCelex, eurLexUrl, isValidCelex } from './celex';

describe('deriveCelex', () => {
  // Every expectation below was verified against the live EUR-Lex SPARQL endpoint on
  // 2026-09-02 — each CELEX resolved to a real work with a document date.
  it.each([
    ['Directive 2014/35/EU', '32014L0035'],
    ['Directive 2014/30/EU', '32014L0030'],
    ['Directive 2012/19/EU WEEE', '32012L0019'],
    ['Directive 2011/65/EU', '32011L0065'],
    ['Regulation (EU) 2023/826', '32023R0826'],
    ['Regulation (EU) 2019/1020', '32019R1020'],
    ['Regulation (EU) 2017/1369', '32017R1369'],
  ])('derives %s -> %s', (ref, celex) => {
    expect(deriveCelex(ref)?.celex).toBe(celex);
  });

  it('reads the pre-2015 "No <number>/<year>" form in the right order', () => {
    // Positional reading would give 32066R2014, which is not a document.
    expect(deriveCelex('Regulation (EU) No 66/2014')?.celex).toBe('32014R0066');
  });

  it('handles two plausible years, disambiguated by the word "No"', () => {
    // REACH: 1907 is a valid year AND the sequential number. "No" settles it.
    expect(deriveCelex('Regulation (EC) No 1907/2006')?.celex).toBe('32006R1907');
  });

  it('prefers the modern year-first reading when nothing says "No"', () => {
    expect(deriveCelex('Regulation (EU) 2019/2016')?.celex).toBe('32019R2016');
  });

  it('finds the act word anywhere, because TCF codes prefix it', () => {
    // The TCF library really does store "EMC Directive 2014/30/EU".
    expect(deriveCelex('EMC Directive 2014/30/EU')?.celex).toBe('32014L0030');
    expect(deriveCelex('LVD 2014/35/EU')).toBeNull(); // no act word — a nickname, not a citation
  });

  it('reports the act type', () => {
    expect(deriveCelex('Directive 2014/35/EU')?.actType).toBe('L');
    expect(deriveCelex('Regulation (EU) 2023/826')?.actType).toBe('R');
    expect(deriveCelex('Decision 2010/15/EU')?.actType).toBe('D');
  });

  it('returns null for standards, which have no CELEX at all', () => {
    for (const ref of [
      'EN IEC 60335-1:2021',
      'EN 60335-2-24',
      'EN60335-2-24 Chapter 7',
      'IEC 60335-2-30 - Chapter 7',
      'EN 60529',
      'Blue Guide 2022',
      'UKCA marking guidance',
    ]) {
      expect(deriveCelex(ref), ref).toBeNull();
    }
  });

  it('returns null for empty or malformed input', () => {
    expect(deriveCelex('')).toBeNull();
    expect(deriveCelex(null)).toBeNull();
    expect(deriveCelex(undefined)).toBeNull();
    expect(deriveCelex('Directive with no numbers')).toBeNull();
  });
});

describe('isValidCelex', () => {
  it('accepts a base act CELEX', () => {
    expect(isValidCelex('32014L0035')).toBe(true);
    expect(isValidCelex(' 32023r0826 ')).toBe(true);
  });

  it('rejects anything that is not one', () => {
    expect(isValidCelex('2014/35/EU')).toBe(false);
    expect(isValidCelex('EN 60529')).toBe(false);
    expect(isValidCelex('')).toBe(false);
  });
});

describe('consolidatedDate', () => {
  it('extracts the consolidation date from a consolidated CELEX', () => {
    expect(consolidatedDate('02014L0035-20260530')).toBe('2026-05-30');
    expect(consolidatedDate('02023R0826-20251124')).toBe('2025-11-24');
  });

  it('returns null for a base CELEX, which carries no date', () => {
    expect(consolidatedDate('32014L0035')).toBeNull();
    expect(consolidatedDate(null)).toBeNull();
  });
});

describe('eurLexUrl', () => {
  it('builds the public page URL', () => {
    expect(eurLexUrl('32014L0035'))
      .toBe('https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0035');
  });
});
