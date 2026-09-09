import { describe, it, expect } from 'vitest';
import {
  buildChart,
  applyFilters,
  bySupplier,
  filterOptions,
  priceOf,
  supplierOptions,
  CARD_H,
  CARD_H_COMPACT,
  CARD_W,
} from './chart';
import { niceTicks } from './format';
import type { RoadmapSku } from '../../types';

const sku = (id: string, over: Partial<RoadmapSku> = {}): RoadmapSku => ({
  sku: id,
  description: `SKU ${id}`,
  family: 'Ceiling',
  systemIndex: 'Fans',
  image: '',
  supplier: 'ACME',
  shop: '',
  amazon: '',
  price: 15,
  attrs: { 'Segment 01': '122cm' },
  nov25: null, novfc25: null, fcff25: null, noq25: null, sm25: null, asp25: null, claim25: null,
  nov26: null, novfc26: null, fcff26: null, noq26: null, sm26: 0.3, asp26: 30, claim26: null,
  isCurrent: true,
  lastSeenAt: null,
  ...over,
});

describe('applyFilters', () => {
  const skus = [
    sku('1', { family: 'Ceiling', supplier: 'ACME', description: 'Fan 122cm' }),
    sku('2', { family: 'Tower', supplier: 'Globex', description: 'Tower 90cm' }),
    sku('3', { family: 'Ceiling', supplier: 'Globex', description: 'Fan 132cm' }),
  ];

  it('returns everything when no filter is set', () => {
    expect(applyFilters(skus, {})).toHaveLength(3);
  });

  it('filters by family and by supplier', () => {
    expect(applyFilters(skus, { families: new Set(['Ceiling']) }).map(r => r.sku)).toEqual(['1', '3']);
    expect(applyFilters(skus, { suppliers: new Set(['Globex']) }).map(r => r.sku)).toEqual(['2', '3']);
  });

  it('combines filters conjunctively', () => {
    const out = applyFilters(skus, {
      families: new Set(['Ceiling']),
      suppliers: new Set(['Globex']),
    });
    expect(out.map(r => r.sku)).toEqual(['3']);
  });

  it('matches title text case-insensitively on the description', () => {
    expect(applyFilters(skus, { title: '132CM' }).map(r => r.sku)).toEqual(['3']);
  });

  it('ignores a segment filter with no field chosen', () => {
    expect(applyFilters(skus, { segVals: new Set(['122cm']) })).toHaveLength(3);
  });
});

describe('buildChart', () => {
  it('groups into lanes by the chosen field and sorts each lane by price', () => {
    const c = buildChart({
      skus: [
        sku('1', { asp26: 50, attrs: { 'Segment 01': '122cm' } }),
        sku('2', { asp26: 20, attrs: { 'Segment 01': '122cm' } }),
        sku('3', { asp26: 30, attrs: { 'Segment 01': '132cm' } }),
      ],
      laneField: 'Segment 01',
    });
    expect(c.lanes.map(l => l.label)).toEqual(['122cm', '132cm']);
    expect(c.lanes[0].items.map(r => r.sku)).toEqual(['2', '1']);
  });

  it('falls back to a single lane when no lane field is chosen', () => {
    const c = buildChart({ skus: [sku('1'), sku('2')], laneField: '' });
    expect(c.lanes).toHaveLength(1);
    expect(c.lanes[0].label).toBe('All SKUs');
  });

  it('buckets a SKU with no value for the lane field under a dash', () => {
    const c = buildChart({ skus: [sku('1', { attrs: {} })], laneField: 'Segment 01' });
    expect(c.lanes[0].label).toBe('—');
  });

  it('drops and counts SKUs with no value on the chosen price axis', () => {
    const c = buildChart({ skus: [sku('1', { asp26: 30 }), sku('2', { asp26: null })] });
    expect(c.usable).toHaveLength(1);
    expect(c.dropped).toBe(1);
  });

  it('switches the price axis between ASP and factory price', () => {
    const r = sku('1', { asp26: 30, price: 15 });
    expect(priceOf(r, 'asp')).toBe(30);
    expect(priceOf(r, 'fp')).toBe(15);
  });

  it('returns an empty, non-throwing chart when everything is filtered out', () => {
    const c = buildChart({ skus: [] });
    expect(c.lanes).toEqual([]);
    expect(c.totalWidth).toBe(0);
  });

  it('stacks cards onto a second level when they would overlap', () => {
    // Three SKUs at nearly the same price cannot sit side by side.
    const c = buildChart({
      skus: [sku('1', { asp26: 30 }), sku('2', { asp26: 30.01 }), sku('3', { asp26: 30.02 })],
    });
    const levels = c.lanes[0].placed!.map(p => p.level);
    expect(new Set(levels).size).toBeGreaterThan(1);
  });

  it('keeps well-separated cards on one level', () => {
    const c = buildChart({ skus: [sku('1', { asp26: 10 }), sku('2', { asp26: 500 })] });
    expect(c.lanes[0].placed!.every(p => p.level === 0)).toBe(true);
  });

  it('positions cards in ascending price order along the axis', () => {
    const c = buildChart({ skus: [sku('1', { asp26: 10 }), sku('2', { asp26: 100 })] });
    const [a, b] = c.lanes[0].placed!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.x - a.x).toBeGreaterThan(CARD_W / 2);
  });

  it('computes per-lane summary stats', () => {
    const c = buildChart({
      skus: [sku('1', { asp26: 10, sm26: 0.2 }), sku('2', { asp26: 30, sm26: 0.4 })],
    });
    const s = c.lanes[0].stats!;
    expect(s.n).toBe(2);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
    expect(s.avgPrice).toBe(20);
    expect(s.avgSm).toBeCloseTo(0.3);
  });

  it('reports a null average SM when no SKU in the lane has one', () => {
    const c = buildChart({ skus: [sku('1', { sm26: null })] });
    expect(c.lanes[0].stats!.avgSm).toBeNull();
  });

  it('shares one price scale across every lane', () => {
    const c = buildChart({
      skus: [
        sku('1', { asp26: 10, attrs: { 'Segment 01': 'a' } }),
        sku('2', { asp26: 10, attrs: { 'Segment 01': 'b' } }),
      ],
      laneField: 'Segment 01',
    });
    expect(c.lanes[0].placed![0].x).toBe(c.lanes[1].placed![0].x);
  });
});

describe('niceTicks', () => {
  it('produces round, ascending values inside the range', () => {
    const t = niceTicks(0, 100, 8);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(100);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });

  it('degenerates safely when the range has no span', () => {
    expect(niceTicks(5, 5, 8)).toEqual([5]);
  });
});

describe('filterOptions', () => {
  it('lists distinct families, suppliers and segment values', () => {
    const opts = filterOptions(
      [
        sku('1', { family: 'Ceiling', supplier: 'ACME', attrs: { 'Segment 01': '122cm' } }),
        sku('2', { family: 'Tower', supplier: 'ACME', attrs: { 'Segment 01': '132cm' } }),
      ],
      'Segment 01',
    );
    expect(opts.families).toEqual(['Ceiling', 'Tower']);
    expect(opts.suppliers).toEqual(['ACME']);
    expect(opts.segValues).toEqual(['122cm', '132cm']);
  });
});

describe('bySupplier', () => {
  const skus = [
    sku('1', { supplier: 'ACME' }),
    sku('2', { supplier: 'Globex' }),
    sku('3', { supplier: '' }),
  ];

  it('returns the very same array when no supplier is chosen', () => {
    // Identity, not just equality — the result feeds useMemo dependencies upstream.
    expect(bySupplier(skus, '')).toBe(skus);
  });

  it('keeps only the chosen supplier', () => {
    expect(bySupplier(skus, 'Globex').map(r => r.sku)).toEqual(['2']);
  });

  // The stand-in has to round-trip, or a SKU with a blank Supplier column would be reachable from
  // the dropdown but match nothing when picked.
  it('reaches SKUs with no supplier through the dash stand-in', () => {
    expect(supplierOptions(skus)).toContain('—');
    expect(bySupplier(skus, '—').map(r => r.sku)).toEqual(['3']);
  });
});

describe('supplierOptions', () => {
  it('lists each supplier once, sorted, with the dash stand-in for blanks', () => {
    expect(
      supplierOptions([
        sku('1', { supplier: 'Globex' }),
        sku('2', { supplier: 'ACME' }),
        sku('3', { supplier: 'Globex' }),
        sku('4', { supplier: '' }),
      ]),
    ).toEqual(['ACME', 'Globex', '—']);
  });

  it('is empty for an empty board', () => {
    expect(supplierOptions([])).toEqual([]);
  });
});

describe('buildChart in presentation mode', () => {
  // Cards lose their price/margin/volume rows, so lanes must stack on the shorter height —
  // otherwise every lane carries a band of dead space where the numbers used to be.
  const skus = [sku('1', { asp26: 10 }), sku('2', { asp26: 200 })];

  it('stacks lanes on the compact card height', () => {
    const full = buildChart({ skus, hideMetrics: false });
    const compact = buildChart({ skus, hideMetrics: true });
    expect(full.lanes[0].height).toBe(CARD_H + 24);
    expect(compact.lanes[0].height).toBe(CARD_H_COMPACT + 24);
  });

  it('changes nothing about which SKUs are placed or where', () => {
    const full = buildChart({ skus, hideMetrics: false });
    const compact = buildChart({ skus, hideMetrics: true });
    expect(compact.lanes[0].placed!.map(p => [p.r.sku, p.x])).toEqual(
      full.lanes[0].placed!.map(p => [p.r.sku, p.x]),
    );
  });
});
