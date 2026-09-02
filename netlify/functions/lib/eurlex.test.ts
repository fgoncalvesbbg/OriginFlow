import { describe, it, expect } from 'vitest';

import {
  NO_END_OF_VALIDITY,
  buildVersionQuery,
  consolidatedDate,
  decideState,
  parseVersionResults,
  type EurLexFacts,
} from './eurlex';

describe('buildVersionQuery', () => {
  it('batches every CELEX into one VALUES clause', () => {
    const q = buildVersionQuery(['32014L0035', '32023R0826']);
    expect(q).toContain('VALUES ?celex { "32014L0035"^^xsd:string "32023R0826"^^xsd:string }');
  });

  it('uses the predicates that actually carry triples', () => {
    // These two were found by enumerating inbound predicates on a real work; the
    // plausible-looking alternatives return empty silently. See lib/eurlex.ts.
    const q = buildVersionQuery(['32014L0035']);
    expect(q).toContain('cdm:act_consolidated_consolidates_resource_legal');
    expect(q).toContain('cdm:resource_legal_amends_resource_legal');
  });

  it('strips anything that could break out of the string literal', () => {
    const q = buildVersionQuery(['32014L0035" } INJECTED {']);
    expect(q).toContain('"32014L0035INJECTED"^^xsd:string');
    expect(q).not.toContain('INJECTED {');
  });
});

describe('parseVersionResults', () => {
  // Shape copied from a real endpoint response captured on 2026-09-02.
  const raw = {
    head: { vars: ['celex', 'documentDate', 'endOfValidity', 'latestConsolidated', 'amendments', 'lastAmendedOn'] },
    results: {
      bindings: [
        {
          celex: { value: '32014L0035' },
          documentDate: { value: '2014-02-26' },
          endOfValidity: { value: '9999-12-31' },
          latestConsolidated: { value: '02014L0035-20260530' },
          amendments: { value: '1' },
          lastAmendedOn: { value: '2024-10-09' },
        },
      ],
    },
  };

  it('keys facts by CELEX and derives the consolidation date from the suffix', () => {
    const m = parseVersionResults(raw);
    const f = m.get('32014L0035')!;
    expect(f.latestConsolidated).toBe('02014L0035-20260530');
    expect(f.latestConsolidatedOn).toBe('2026-05-30');
    expect(f.amendments).toBe(1);
    expect(f.lastAmendedOn).toBe('2024-10-09');
  });

  it('returns an empty map rather than throwing on a malformed response', () => {
    expect(parseVersionResults(null).size).toBe(0);
    expect(parseVersionResults({}).size).toBe(0);
    expect(parseVersionResults({ results: { bindings: [{}] } }).size).toBe(0);
  });
});

describe('consolidatedDate', () => {
  it('reads the yyyymmdd suffix', () => {
    expect(consolidatedDate('02023R0826-20251124')).toBe('2025-11-24');
  });
  it('is undefined for a base CELEX', () => {
    expect(consolidatedDate('32023R0826')).toBeUndefined();
  });
});

describe('decideState', () => {
  const lvd: EurLexFacts = {
    celex: '32014L0035',
    documentDate: '2014-02-26',
    endOfValidity: NO_END_OF_VALIDITY,
    latestConsolidated: '02014L0035-20260530',
    latestConsolidatedOn: '2026-05-30',
    amendments: 1,
    lastAmendedOn: '2024-10-09',
  };

  it('flags a consolidation newer than what we record', () => {
    // This is the live LVD case: our row says 2014, EUR-Lex consolidated it in 2026.
    expect(decideState(lvd, '2014-02-26')).toBe('newer_available');
  });

  it('says current once our row has caught up', () => {
    expect(decideState(lvd, '2026-05-30')).toBe('current');
    expect(decideState(lvd, '2026-08-01')).toBe('current');
  });

  it('falls back to the document date when we record nothing', () => {
    expect(decideState(lvd, null)).toBe('newer_available');
  });

  it('reports a repeal ahead of any newer version', () => {
    const repealed: EurLexFacts = { ...lvd, endOfValidity: '2020-01-01' };
    expect(decideState(repealed, '2014-02-26', '2026-09-02')).toBe('repealed');
  });

  it('treats the 9999-12-31 sentinel as still in force, not as a future repeal', () => {
    expect(decideState({ ...lvd, latestConsolidatedOn: undefined, lastAmendedOn: undefined }, '2014-02-26'))
      .toBe('current');
  });

  it('does not call an end-of-validity still in the future a repeal', () => {
    const sunsetting: EurLexFacts = { ...lvd, endOfValidity: '2030-01-01' };
    expect(decideState(sunsetting, '2026-05-30', '2026-09-02')).toBe('current');
  });

  it('is not_found when the CELEX resolved to nothing', () => {
    expect(decideState(undefined, '2014-02-26')).toBe('not_found');
  });

  it('uses the newest of consolidation and amendment, whichever leads', () => {
    const amendedAfterConsolidation: EurLexFacts = {
      ...lvd, latestConsolidatedOn: '2025-01-01', lastAmendedOn: '2026-07-01',
    };
    expect(decideState(amendedAfterConsolidation, '2025-06-01')).toBe('newer_available');
  });
});
