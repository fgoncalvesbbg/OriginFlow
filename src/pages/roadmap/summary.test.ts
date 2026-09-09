import { describe, it, expect } from 'vitest';
import { buildSummary } from './summary';
import { fmtK, fmtPct, fmtFp, smTone, yoyOf, slugify } from './format';
import type { RoadmapAxisValue, RoadmapItemFlag, RoadmapPlacer, RoadmapSku } from '../../types';

const sku = (id: string, over: Partial<RoadmapSku> = {}): RoadmapSku => ({
  sku: id,
  description: `Fan ${id}`,
  family: 'Ceiling',
  systemIndex: 'Fans',
  image: '',
  price: null,
  supplier: '',
  shop: '',
  amazon: '',
  attrs: {},
  nov25: null, novfc25: null, fcff25: null, noq25: null, sm25: null, asp25: null, claim25: null,
  nov26: null, novfc26: null, fcff26: null, noq26: null, sm26: null, asp26: null, claim26: null,
  isCurrent: true,
  lastSeenAt: null,
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

const placer = (over: Partial<RoadmapPlacer> & Pick<RoadmapPlacer, 'id' | 'type'>): RoadmapPlacer => ({
  category: 'Fans',
  yField: 'Main Color',
  xField: 'Segment 01',
  family: 'Ceiling',
  yValue: 'Black',
  xValue: '122cm',
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

const axis = (
  over: Partial<RoadmapAxisValue> & Pick<RoadmapAxisValue, 'id' | 'kind' | 'value'>,
): RoadmapAxisValue => ({
  category: 'Fans',
  field: null,
  createdBy: null,
  ...over,
});

const opts = { category: 'Fans', generatedAt: '2026-08-25 10:00' };

describe('buildSummary', () => {
  it('says so plainly when nothing has been marked', () => {
    const out = buildSummary({ ...opts, skus: [sku('1')] });
    expect(out).toContain('(No flags or changes recorded for this category.)');
  });

  it('groups flagged SKUs under their heading with notes and author', () => {
    const out = buildSummary({
      ...opts,
      skus: [sku('1'), sku('2')],
      flags: [
        flag({ sku: '1', flag: 'eol', comment: 'runs out Q3', updatedBy: 'Alex' }),
        flag({ sku: '2', flag: 'replace' }),
      ],
    });
    expect(out).toContain('END OF LIFE (EOL) (1)');
    expect(out).toContain('REPLACEMENTS (1)');
    expect(out).toContain('note: runs out Q3');
    expect(out).toContain('by: Alex');
  });

  it('ignores a flag whose SKU is not in this category', () => {
    const out = buildSummary({
      ...opts,
      skus: [sku('1')],
      flags: [flag({ sku: '999', flag: 'eol' })],
    });
    expect(out).not.toContain('END OF LIFE');
  });

  it('counts placeholder spots by type in the totals line', () => {
    const out = buildSummary({
      ...opts,
      skus: [sku('1')],
      placers: [
        placer({ id: 1, type: 'new', comment: 'premium tier' }),
        placer({ id: 2, type: 'upcoming', yValue: 'White', xValue: '132cm' }),
      ],
    });
    expect(out).toContain('1 new-item spot(s), 1 upcoming spot(s)');
    expect(out).toContain('NEW ITEMS TO LAUNCH (flagged spots) (1)');
    expect(out).toContain('Ceiling / Black / 122cm');
    expect(out).toContain('(axes: Main Color × Segment 01)');
    expect(out).toContain('note: premium tier');
  });

  it('lists manually added families, rows and columns separately', () => {
    const out = buildSummary({
      ...opts,
      skus: [sku('1')],
      axisValues: [
        axis({ id: 1, kind: 'family', field: null, value: 'Planned Line' }),
        axis({ id: 2, kind: 'row', field: 'Main Color', value: 'Copper' }),
        axis({ id: 3, kind: 'col', field: 'Segment 01', value: '152cm' }),
      ],
    });
    expect(out).toContain('ADDED FAMILIES (1)');
    expect(out).toContain('Planned Line');
    expect(out).toContain('Copper  (Main Color)');
    expect(out).toContain('ADDED COLUMNS (1)');
  });

  it('calls out SKUs kept from an older export, and marks their flags', () => {
    const out = buildSummary({
      ...opts,
      skus: [sku('1', { isCurrent: false })],
      flags: [flag({ sku: '1', flag: 'eol' })],
    });
    expect(out).toContain('NOT IN LATEST FILE (1)');
    expect(out).toContain('[not in latest file]');
    // The report has to say WHY a delisted SKU is still on it, or a reader assumes it is stale.
    expect(out).toContain('kept because they still carry roadmap notes or history');
  });

  it('carries the category and a generation timestamp', () => {
    const out = buildSummary({ ...opts, skus: [] });
    expect(out).toContain('Category: Fans');
    expect(out).toContain('Generated: 2026-08-25 10:00');
  });
});

describe('format helpers', () => {
  it('compacts volumes', () => {
    expect(fmtK(950)).toBe('950');
    expect(fmtK(42000)).toBe('42k');
    expect(fmtK(1250000)).toBe('1.3M');
    expect(fmtK(null)).toBe('—');
  });

  it('formats percentages and prices', () => {
    expect(fmtPct(0.284)).toBe('28.4%');
    expect(fmtFp(41.5)).toBe('$41.50');
    expect(fmtPct(null)).toBe('—');
  });

  it('maps steering margin onto the status vocabulary', () => {
    expect(smTone(0.3)).toBe('good');
    expect(smTone(0.2)).toBe('warn');
    expect(smTone(0.1)).toBe('bad');
    expect(smTone(null)).toBe('none');
  });

  it('computes YoY growth, and refuses to divide by a zero base', () => {
    expect(yoyOf({ nov25: 100, novfc26: 150 })).toBeCloseTo(0.5);
    expect(yoyOf({ nov25: 0, novfc26: 150 })).toBeNull();
    expect(yoyOf({ nov25: 100, novfc26: null })).toBeNull();
  });

  it('makes a filename-safe slug', () => {
    expect(slugify('Climate-Fans-Ceiling Fans')).toBe('Climate_Fans_Ceiling_Fans');
    expect(slugify('')).toBe('category');
  });
});
