import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, selectRows, rpcRows, failures } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; where?: any; params?: any }>,
  selectRows: { rows: [] as any[] },
  rpcRows: { rows: [] as any[] },
  failures: { select: false, rpc: false },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where });
        if (failures.select) return Promise.reject(new Error('database unavailable'));
        return Promise.resolve(selectRows.rows);
      }),
      rpc: vi.fn((routine: string, params: any) => {
        calls.push({ op: 'rpc', table: routine, params });
        if (failures.rpc) return Promise.reject(new Error('rpc unavailable'));
        return Promise.resolve(rpcRows.rows);
      }),
    },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  evaluateCandidate,
  fetchTmCandidates,
  lookupTmSegment,
  prefetchTmForRun,
  type TmLookupRequest,
  type TmSegmentRecord,
} from './im-tm-lookup.service';
import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';
import { tokenizeForCompare } from './im-tm-similarity';
import { buildTmSourceUnits } from './im-tm-core';

const SOURCE = 'Do not immerse the appliance in water at any time.';
const KEY = 'a'.repeat(32);
const CTX = 'c'.repeat(32);

const request = (over: Partial<TmLookupRequest> = {}): TmLookupRequest => {
  const placeholderedSource = over.placeholderedSource ?? SOURCE;
  return {
    key: 'frag#0#de',
    sourceLocale: 'en',
    targetLocale: 'de',
    sourceKey: KEY,
    plainKey: 'b'.repeat(32),
    contextKey: CTX,
    placeholderedSource,
    placeholderTypes: [],
    placeholderSafe: true,
    compareTokens: tokenizeForCompare(placeholderedSource, over.placeholderTypes ?? []),
    ...over,
  };
};

const record = (over: Partial<TmSegmentRecord> = {}): TmSegmentRecord => ({
  id: 'seg-1',
  sourceLocale: 'en',
  targetLocale: 'de',
  sourceKey: KEY,
  plainKey: 'b'.repeat(32),
  contextKey: CTX,
  sourceFingerprint: 'd'.repeat(32),
  placeholderedSource: SOURCE,
  rawSource: SOURCE,
  targetText: 'Das Gerat niemals in Wasser eintauchen.',
  placeholderTypes: [],
  tokenIdentities: [],
  placeholderSafe: true,
  container: 'p',
  anchorPath: 'p[0]/s0',
  domainCategoryId: null,
  domainContentType: null,
  origin: 'machine',
  status: 'approved',
  regulatoryRefs: [],
  segmentationVersion: SEGMENTATION_VERSION,
  normalizationVersion: NORMALIZATION_VERSION,
  placeholderVersion: PLACEHOLDER_VERSION,
  usageCount: 0,
  reviewedBy: 'admin@example.test',
  createdBy: 'pm@example.test',
  ...over,
});

const asRow = (r: TmSegmentRecord): any => ({
  id: r.id,
  source_locale: r.sourceLocale,
  target_locale: r.targetLocale,
  source_key: r.sourceKey,
  plain_key: r.plainKey,
  context_key: r.contextKey,
  source_fingerprint: r.sourceFingerprint,
  placeholdered_source: r.placeholderedSource,
  raw_source: r.rawSource,
  target_text: r.targetText,
  placeholder_types: r.placeholderTypes,
  token_identities: r.tokenIdentities,
  placeholder_safe: r.placeholderSafe,
  container: r.container,
  anchor_path: r.anchorPath,
  domain_category_id: r.domainCategoryId,
  domain_content_type: r.domainContentType,
  origin: r.origin,
  status: r.status,
  regulatory_refs: r.regulatoryRefs,
  segmentation_version: r.segmentationVersion,
  normalization_version: r.normalizationVersion,
  placeholder_version: r.placeholderVersion,
  usage_count: r.usageCount,
  reviewed_by: r.reviewedBy,
  created_by: r.createdBy,
});

beforeEach(() => {
  calls.length = 0;
  selectRows.rows = [];
  rpcRows.rows = [];
  failures.select = false;
  failures.rpc = false;
});

describe('evaluateCandidate — the tier cascade', () => {
  it('returns perfect (exact_in_context) and auto-applies an approved same-context hit', () => {
    const m = evaluateCandidate(request(), record());
    expect(m.tier).toBe('exact_in_context');
    expect(m.matchPercent).toBe(100);
    expect(m.autoApply).toBe(true);
    expect(m.localeDistance).toBe(0);
  });

  it('returns exact and still auto-applies when only the context differs', () => {
    const m = evaluateCandidate(request(), record({ contextKey: 'z'.repeat(32) }));
    expect(m.tier).toBe('exact');
    expect(m.autoApply).toBe(true);
  });

  it('NEVER auto-applies an unreviewed row, even on a 100% text match', () => {
    const m = evaluateCandidate(request(), record({ status: 'unreviewed' }));
    expect(m.autoApply).toBe(false);
    expect(m.referenceOnly).toBe(true);
    expect(m.reason).toContain('not approved');
  });

  it('never auto-applies across a stored-version change', () => {
    const m = evaluateCandidate(request(), record({ normalizationVersion: NORMALIZATION_VERSION + 1 }));
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('different segmentation/normalization version');
  });

  it('never auto-applies when the ordered placeholder types differ', () => {
    const m = evaluateCandidate(
      request({ placeholderTypes: ['measure'] }),
      record({ placeholderTypes: ['code'] }),
    );
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('placeholder type order differs');
  });

  it('refuses to apply when the two sides disagree on placeholder safety', () => {
    // Key construction makes this state unreachable today (an unsafe segment keeps
    // literal values while a safe one carries {{Pn}} markers, so they cannot share a
    // key). The guard exists so that a future change to key construction fails closed
    // instead of quietly making non-interchangeable rows interchangeable.
    const m = evaluateCandidate(request({ placeholderSafe: false }), record({ placeholderSafe: true }));
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('disagree on placeholder safety');
  });

  it('still auto-applies an exact match when BOTH sides are unsafe', () => {
    // An equal key between two unsafe segments means the literal source text — numerals
    // included — is identical, so there is nothing to re-inject and reuse is safe.
    const m = evaluateCandidate(
      request({ placeholderSafe: false }),
      record({ placeholderSafe: false }),
    );
    expect(m.tier).toBe('exact_in_context');
    expect(m.autoApply).toBe(true);
  });

  it('never auto-applies a hit that came from a parent locale', () => {
    // Austrian and German legal wording differ; storing full locales exists precisely
    // so the system refuses to pretend otherwise.
    const m = evaluateCandidate(request({ targetLocale: 'de-AT' }), record({ targetLocale: 'de' }));
    expect(m.localeDistance).toBe(1);
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('fallback');
  });

  it('auto-applies an exact-locale hit for a regional request', () => {
    const m = evaluateCandidate(request({ targetLocale: 'de-AT' }), record({ targetLocale: 'de-AT' }));
    expect(m.localeDistance).toBe(0);
    expect(m.autoApply).toBe(true);
  });

  it('restricts a regulation-bearing segment to identical context only', () => {
    const refs = ['(EU) 2019/2016'];
    const inContext = evaluateCandidate(request(), record({ regulatoryRefs: refs }));
    expect(inContext.tier).toBe('exact_in_context');
    expect(inContext.autoApply).toBe(true);

    const crossContext = evaluateCandidate(
      request(),
      record({ regulatoryRefs: refs, contextKey: 'z'.repeat(32) }),
    );
    expect(crossContext.tier).toBe('exact');
    expect(crossContext.autoApply).toBe(false);
    expect(crossContext.reason).toContain('regulatory reference');
  });

  it('refuses to apply a key match whose stored source text disagrees (hash collision guard)', () => {
    // This is what lets the key be a fast non-cryptographic hash: a collision degrades
    // to a miss, never to a wrong translation.
    const m = evaluateCandidate(request(), record({ placeholderedSource: 'A completely different sentence.' }));
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('does not match despite an equal key');
  });

  it('caps a candidate whose numeral differs and refuses to apply it', () => {
    const src = 'The water tank of this appliance holds exactly 2.5 l when filled.';
    const stored = 'The water tank of this appliance holds exactly 3.0 l when filled.';
    const m = evaluateCandidate(
      request({ sourceKey: 'x'.repeat(32), placeholderedSource: src }),
      record({ sourceKey: 'y'.repeat(32), placeholderedSource: stored }),
    );
    expect(m.autoApply).toBe(false);
    expect(m.reason).toContain('numeral, unit, identifier or chip differs');
  });
});

describe('prefetchTmForRun', () => {
  it('resolves the whole run with a SINGLE exact query', async () => {
    selectRows.rows = [asRow(record())];
    const reqs = [
      request({ key: 'f#0#de' }),
      request({ key: 'f#1#de', sourceKey: 'q'.repeat(32) }),
      request({ key: 'f#2#fr', targetLocale: 'fr' }),
    ];
    const cache = await prefetchTmForRun(reqs);
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(1);
    expect(cache.get('f#0#de').tier).toBe('exact_in_context');
  });

  it('asks for the full locale fallback chain', async () => {
    await prefetchTmForRun([request({ targetLocale: 'de-AT' })]);
    const where = calls.find((c) => c.op === 'select')?.where;
    expect(where.target_locale).toEqual(expect.arrayContaining(['de-AT', 'de']));
  });

  it('only ever asks for approved and unreviewed rows, never deprecated ones', async () => {
    await prefetchTmForRun([request()]);
    expect(calls.find((c) => c.op === 'select')?.where.status).toEqual(['approved', 'unreviewed']);
  });

  it('degrades to a full miss when the memory is unreadable, without throwing', async () => {
    failures.select = true;
    const cache = await prefetchTmForRun([request()]);
    expect(cache.unavailable).toBe(true);
    expect(cache.get('frag#0#de').tier).toBe('none');
    expect(cache.stats.unavailable).toBe(1);
  });

  it('degrades to a miss when the fuzzy rpc fails', async () => {
    failures.rpc = true;
    const cache = await prefetchTmForRun([request({ sourceKey: 'nomatch'.padEnd(32, '0') })]);
    expect(cache.get('frag#0#de').tier).toBe('none');
  });

  it('falls through to the fuzzy stage for a segment that missed exactly', async () => {
    selectRows.rows = [];
    rpcRows.rows = [
      asRow(record({ sourceKey: 'z'.repeat(32), placeholderedSource: 'Do not immerse the appliance in clean water at any time.' })),
    ];
    const cache = await prefetchTmForRun([request()]);
    expect(calls.some((c) => c.op === 'rpc' && c.table === 'im_tm_fuzzy_candidates')).toBe(true);
    const match = cache.get('frag#0#de');
    expect(match.tier).not.toBe('none');
    expect(match.autoApply).toBe(false);
  });

  it('skips the fuzzy stage for a short segment, where recall is pure noise', async () => {
    const cache = await prefetchTmForRun([request({ placeholderedSource: 'Cleaning' })]);
    expect(calls.some((c) => c.op === 'rpc')).toBe(false);
    expect(cache.get('frag#0#de').tier).toBe('none');
  });

  it('issues one fuzzy call for identical source text shared by several requests', async () => {
    await prefetchTmForRun([
      request({ key: 'a#de' }),
      request({ key: 'b#de' }),
      request({ key: 'c#de' }),
    ]);
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(1);
  });

  it('touches the port not at all when the app is not configured', async () => {
    vi.resetModules();
    vi.doMock('../../config/environment.config', () => ({ isLive: false }));
    const mod = await import('./im-tm-lookup.service');
    calls.length = 0;
    const cache = await mod.prefetchTmForRun([request()]);
    expect(calls).toHaveLength(0);
    expect(cache.get('frag#0#de').tier).toBe('none');
    vi.doUnmock('../../config/environment.config');
    vi.resetModules();
  });

  it('counts every request in the stats, hit or miss', async () => {
    selectRows.rows = [asRow(record())];
    const cache = await prefetchTmForRun([
      request({ key: 'hit' }),
      request({ key: 'miss', sourceKey: 'nomatch'.padEnd(32, '0') }),
    ]);
    const total = cache.stats.exact_in_context + cache.stats.exact + cache.stats.fuzzy_auto
      + cache.stats.fuzzy_review + cache.stats.reference + cache.stats.none;
    expect(total).toBe(2);
  });

  it('picks deterministically between equal-tier candidates', async () => {
    selectRows.rows = [
      asRow(record({ id: 'seg-low', usageCount: 1 })),
      asRow(record({ id: 'seg-high', usageCount: 99 })),
    ];
    const a = await prefetchTmForRun([request()]);
    const b = await prefetchTmForRun([request()]);
    expect(a.get('frag#0#de').segment?.id).toBe('seg-high');
    expect(b.get('frag#0#de').segment?.id).toBe('seg-high');
  });
});

describe('lookupTmSegment', () => {
  it('wraps the batched path for a single segment', async () => {
    selectRows.rows = [asRow(record())];
    const m = await lookupTmSegment(request());
    expect(m.tier).toBe('exact_in_context');
  });
});

describe('fetchTmCandidates', () => {
  it('returns only suggestions above the review floor, best first', async () => {
    rpcRows.rows = [
      asRow(record({ id: 'far', sourceKey: 'z1'.padEnd(32, '0'), placeholderedSource: 'Register the warranty online today.' })),
      asRow(record({ id: 'near', sourceKey: 'z2'.padEnd(32, '0'), placeholderedSource: 'Do not immerse the appliance in clean water at any time.' })),
    ];
    const out = await fetchTmCandidates(request());
    expect(out[0].segment?.id).toBe('near');
    expect(out.every((m) => (m.matchPercent ?? 0) >= 70)).toBe(true);
  });
});

describe('integration with the pure core', () => {
  it('accepts requests built straight from buildTmSourceUnits', async () => {
    const built = buildTmSourceUnits('sec-1#inline:0', '<p>Do not immerse the appliance in water.</p>', {
      sourceLocale: 'en',
    });
    const unit = built.units[0];
    const req: TmLookupRequest = {
      key: unit.anchor.fragmentId + '#' + unit.anchor.index + '#de',
      sourceLocale: 'en',
      targetLocale: 'de',
      sourceKey: unit.keys.segmentKey,
      plainKey: unit.keys.plainKeyHash,
      contextKey: unit.keys.contextHash,
      placeholderedSource: unit.placeholdered.patternText,
      placeholderTypes: unit.placeholdered.placeholders.map((p) => p.type),
      placeholderSafe: unit.placeholdered.placeholderSafe,
      compareTokens: unit.compareTokens,
    };
    selectRows.rows = [
      asRow(record({
        sourceKey: unit.keys.segmentKey,
        contextKey: unit.keys.contextHash,
        placeholderedSource: unit.placeholdered.patternText,
      })),
    ];
    const cache = await prefetchTmForRun([req]);
    const match = cache.get(req.key);
    expect(match.tier).toBe('exact_in_context');
    expect(match.autoApply).toBe(true);
  });
});
