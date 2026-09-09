import { describe, it, expect } from 'vitest';
import { buildGrid, findOrphans, distinctCI, smartSort, cellId } from './grid';
import type { RoadmapAxisValue, RoadmapItemFlag, RoadmapPlacer, RoadmapSku } from '../../types';

/**
 * Fixture factories fill every required field so the tests exercise the real domain types — a
 * column dropped from RoadmapSku breaks these at compile time rather than at runtime on a board.
 */
const sku = (
  id: string,
  family: string,
  color: string,
  size: string,
  extra: Partial<RoadmapSku> = {},
): RoadmapSku => ({
  sku: id,
  description: `SKU ${id}`,
  family,
  systemIndex: 'Fans',
  image: '',
  price: null,
  supplier: '',
  shop: '',
  amazon: '',
  attrs: { 'Main Color': color, 'Segment 01': size },
  nov25: null, novfc25: null, fcff25: null, noq25: null, sm25: null, asp25: null, claim25: null,
  nov26: null, novfc26: null, fcff26: null, noq26: null, sm26: null, asp26: null, claim26: null,
  isCurrent: true,
  lastSeenAt: null,
  ...extra,
});

const placer = (over: Partial<RoadmapPlacer> = {}): RoadmapPlacer => ({
  id: 1,
  category: 'Fans',
  yField: 'Main Color',
  xField: 'Segment 01',
  family: 'Ceiling',
  yValue: 'Black',
  xValue: '122cm',
  type: 'new',
  comment: '',
  projectCode: '',
  expected2027Nic: null,
  status: 'pending',
  approvedBy: null,
  sortOrder: 0,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

const axis = (over: Partial<RoadmapAxisValue> & Pick<RoadmapAxisValue, 'id' | 'kind' | 'value'>): RoadmapAxisValue => ({
  category: 'Fans',
  field: null,
  createdBy: null,
  ...over,
});

const flag = (over: Partial<RoadmapItemFlag> & Pick<RoadmapItemFlag, 'sku'>): RoadmapItemFlag => ({
  flag: null,
  comment: '',
  projectCode: '',
  status: 'pending',
  approvedBy: null,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

const base = { yField: 'Main Color', xField: 'Segment 01' };

describe('distinctCI / smartSort', () => {
  it('keeps the first spelling of a case-insensitive duplicate', () => {
    expect(distinctCI(['Black', 'black', 'White'])).toEqual(['Black', 'White']);
  });

  it('sorts numerically when every value carries a number', () => {
    expect(smartSort(['132cm', '92cm', '122cm'])).toEqual(['92cm', '122cm', '132cm']);
  });

  it('leaves order alone when the values are not all numeric', () => {
    expect(smartSort(['Black', 'White', 'Copper'])).toEqual(['Black', 'White', 'Copper']);
  });

  it('addresses cells case-insensitively', () => {
    expect(cellId('Black', '122cm')).toBe(cellId('black', '122CM'));
  });
});

describe('buildGrid', () => {
  it('pivots SKUs into family bands and cells', () => {
    const g = buildGrid({
      ...base,
      skus: [
        sku('1', 'Ceiling', 'Black', '122cm'),
        sku('2', 'Ceiling', 'Black', '122cm'),
        sku('3', 'Ceiling', 'White', '132cm'),
        sku('4', 'Tower', 'Black', '122cm'),
      ],
    });
    expect(g.families).toEqual(['Ceiling', 'Tower']);
    expect(g.yValues).toEqual(['Black', 'White']);
    expect(g.xValues).toEqual(['122cm', '132cm']);
    expect(g.itemsAt('Ceiling', 'Black', '122cm').map(r => r.sku)).toEqual(['1', '2']);
    expect(g.itemsAt('Tower', 'White', '132cm')).toEqual([]);
  });

  it('counts SKUs missing an axis value instead of dropping them silently', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm'), sku('2', 'Ceiling', '', '122cm')],
    });
    expect(g.skipped).toBe(1);
    expect(g.usableCount).toBe(1);
  });

  it('appends manually added rows, columns and families', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      axisValues: [
        axis({ id: 1, kind: 'row', field: 'Main Color', value: 'Copper' }),
        axis({ id: 2, kind: 'col', field: 'Segment 01', value: '152cm' }),
        axis({ id: 3, kind: 'family', field: null, value: 'Planned Line' }),
      ],
    });
    expect(g.yValues).toContain('Copper');
    expect(g.xValues).toContain('152cm');
    expect(g.families).toEqual(['Ceiling', 'Planned Line']);
    expect(g.isAddedRow('Copper')).toBe(true);
    expect(g.isAddedRow('Black')).toBe(false);
    expect(g.isAddedFamily('Planned Line')).toBe(true);
  });

  it('ignores added rows belonging to a different axis field', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      axisValues: [axis({ id: 1, kind: 'row', field: 'Segment 02', value: 'Irrelevant' })],
    });
    expect(g.yValues).not.toContain('Irrelevant');
  });

  // ── The refresh-safety guarantee ────────────────────────────────────────────
  // These are the tests that matter: a placer must always have a cell to render in, however the
  // reference data shifts under it, or the annotation is invisible and effectively lost.

  it('keeps a cell alive for a placer whose axis values no longer exist on any SKU', () => {
    const g = buildGrid({
      ...base,
      // The export changed: nothing is Black/122cm any more.
      skus: [sku('1', 'Ceiling', 'White', '132cm')],
      placers: [placer({ yValue: 'Black', xValue: '122cm' })],
    });
    expect(g.yValues).toContain('Black');
    expect(g.xValues).toContain('122cm');
    expect(g.placersAt('Ceiling', 'Black', '122cm')).toHaveLength(1);
  });

  it('keeps a family band alive for a placer whose family was renamed upstream', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling Fans EU', 'Black', '122cm')], // family renamed
      placers: [placer({ family: 'Ceiling' })],
    });
    expect(g.families).toContain('Ceiling');
    expect(g.placersAt('Ceiling', 'Black', '122cm')).toHaveLength(1);
  });

  it('does not drag in values from placers drawn on a different axis pair', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      placers: [
        placer({ yField: 'Segment 03', xField: 'Segment 04', yValue: 'Nope', xValue: 'Nah' }),
      ],
    });
    expect(g.yValues).not.toContain('Nope');
    expect(g.xValues).not.toContain('Nah');
  });

  it('orders several placers in one cell by sortOrder', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      placers: [
        placer({ id: 7, sortOrder: 1, comment: 'second' }),
        placer({ id: 6, sortOrder: 0, comment: 'first' }),
      ],
    });
    expect(g.placersAt('Ceiling', 'Black', '122cm').map(p => p.comment)).toEqual([
      'first',
      'second',
    ]);
  });

  it('matches a placer to its cell case-insensitively', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      placers: [placer({ yValue: 'black', xValue: '122CM' })],
    });
    expect(g.placersAt('Ceiling', 'Black', '122cm')).toHaveLength(1);
  });

  it('exposes flags by SKU', () => {
    const g = buildGrid({
      ...base,
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      flags: [flag({ sku: '1', flag: 'eol', comment: 'runs out Q3' })],
    });
    expect(g.flagFor('1')?.flag).toBe('eol');
    expect(g.flagFor('2')).toBeNull();
  });

  it('survives an empty category without throwing', () => {
    const g = buildGrid({ ...base, skus: [] });
    expect(g.yValues).toEqual(['—']);
    expect(g.xValues).toEqual(['—']);
    expect(g.families).toEqual([]);
  });
});

describe('findOrphans', () => {
  it('reports a placer that matches no current SKU', () => {
    const { placers } = findOrphans({
      skus: [sku('1', 'Ceiling', 'White', '132cm')],
      placers: [placer({ yValue: 'Black', xValue: '122cm' })],
    });
    expect(placers).toHaveLength(1);
  });

  it('does not report a placer that still matches a live SKU', () => {
    const { placers } = findOrphans({
      skus: [sku('1', 'Ceiling', 'Black', '122cm')],
      placers: [placer()],
    });
    expect(placers).toHaveLength(0);
  });

  it('ignores delisted SKUs when matching placers, but reports their flags', () => {
    const stale = sku('1', 'Ceiling', 'Black', '122cm', { isCurrent: false });
    const out = findOrphans({
      skus: [stale],
      placers: [placer()],
      flags: [flag({ sku: '1', flag: 'eol' })],
    });
    expect(out.placers).toHaveLength(1);
    expect(out.flags.map(f => f.sku)).toEqual(['1']);
  });
});
