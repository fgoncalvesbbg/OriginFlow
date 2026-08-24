import { describe, it, expect, vi, beforeEach } from 'vitest';

// The port is mocked rather than a driver client, so these tests describe the service's
// contract — which RPC it calls, with what parameters, and how it unwraps the result —
// rather than PostgREST's wire shape. Same reasoning as im-tm-write.service.test.ts.
const { calls, rpcResult } = vi.hoisted(() => ({
  calls: [] as Array<{ routine: string; params: any }>,
  rpcResult: { rows: [] as any[] },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      rpc: vi.fn((routine: string, params: any) => {
        calls.push({ routine, params });
        return Promise.resolve(rpcResult.rows);
      }),
    },
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { browseTmSegments, getTmStats, getTmLeverage } from './im-tm-admin.service';

/** `im_tm_browse` returns the row as a composite column plus the unpaged total. */
const browseRow = (id: string, total: number, over: Record<string, any> = {}) => ({
  segment: {
    id,
    source_locale: 'en',
    target_locale: 'de',
    source_key: 'a'.repeat(32),
    plain_key: 'b'.repeat(32),
    context_key: null,
    source_fingerprint: 'd'.repeat(32),
    placeholdered_source: 'Do not immerse in water.',
    raw_source: 'Do not immerse in water.',
    target_text: 'Nicht in Wasser eintauchen.',
    placeholder_types: [],
    token_identities: [],
    placeholder_safe: true,
    origin: 'machine',
    status: 'unreviewed',
    regulatory_refs: [],
    segmentation_version: 1,
    normalization_version: 1,
    placeholder_version: 1,
    usage_count: 3,
    ...over,
  },
  total_count: total,
});

beforeEach(() => {
  calls.length = 0;
  rpcResult.rows = [];
});

describe('browseTmSegments', () => {
  it('unwraps the composite segment column and reports the unpaged total', async () => {
    rpcResult.rows = [browseRow('seg-1', 1675), browseRow('seg-2', 1675)];
    const page = await browseTmSegments();

    expect(page.rows.map((r) => r.id)).toEqual(['seg-1', 'seg-2']);
    // The total describes the whole filtered set, not this page — the pager depends on it.
    expect(page.total).toBe(1675);
    expect(page.rows[0].usageCount).toBe(3);
    expect(page.rows[0].targetText).toBe('Nicht in Wasser eintauchen.');
  });

  it('passes filters through and sends null — not an empty array — for an unset filter', async () => {
    await browseTmSegments(
      { status: ['unreviewed'], targetLocales: ['de'], origins: [], search: '  Wasser  ', sort: 'queue' },
      { limit: 25, offset: 50 },
    );

    expect(calls[0].routine).toBe('im_tm_browse');
    expect(calls[0].params).toMatchObject({
      p_status: ['unreviewed'],
      p_target_locales: ['de'],
      // An empty selection means "no constraint", never "match nothing".
      p_origins: null,
      p_search: 'Wasser',
      p_sort: 'queue',
      p_limit: 25,
      p_offset: 50,
    });
  });

  it('sends a blank search as null so the SQL skips the comparison entirely', async () => {
    await browseTmSegments({ search: '   ' });
    expect(calls[0].params.p_search).toBeNull();
  });

  it('reports a total of 0 for an empty page rather than throwing on rows[0]', async () => {
    rpcResult.rows = [];
    const page = await browseTmSegments();
    expect(page).toEqual({ rows: [], total: 0 });
  });
});

describe('getTmStats', () => {
  it('maps the grouped counts and coerces the bigint count to a number', async () => {
    // Postgres bigint arrives as a string over PostgREST; an un-coerced value would make
    // the stats strip concatenate instead of add.
    rpcResult.rows = [
      { status: 'unreviewed', target_locale: 'de', origin: 'machine', n: '81' },
      { status: 'approved', target_locale: 'fr', origin: 'human', n: '4' },
    ];
    const stats = await getTmStats();
    expect(stats[0]).toEqual({ status: 'unreviewed', targetLocale: 'de', origin: 'machine', count: 81 });
    expect(stats.reduce((s, r) => s + r.count, 0)).toBe(85);
  });
});

describe('getTmLeverage', () => {
  it('calls the reporting RPC with nulls for every omitted parameter', async () => {
    await getTmLeverage();
    expect(calls[0].routine).toBe('im_tm_leverage');
    expect(calls[0].params).toEqual({
      p_from: null,
      p_to: null,
      p_target_locales: null,
      p_template_id: null,
    });
  });

  it('keeps applied separate from logged, so a reference match is never counted as a saving', async () => {
    rpcResult.rows = [{
      target_locale: 'de',
      domain_category_id: null,
      tier: 'fuzzy_low',
      events: '10',
      chars: '900',
      applied_events: '0',
      applied_chars: '0',
    }];
    const [row] = await getTmLeverage({ from: '2026-08-01T00:00:00.000Z' });
    expect(row.events).toBe(10);
    expect(row.chars).toBe(900);
    expect(row.appliedEvents).toBe(0);
    expect(row.appliedChars).toBe(0);
    expect(calls[0].params.p_from).toBe('2026-08-01T00:00:00.000Z');
  });
});
