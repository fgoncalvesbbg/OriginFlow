import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  NO_VALUE,
  activeFilterCount,
  cellSurvivesValueFilter,
  columnSurvivesFilter,
  rowSurvivesFilter,
  summarise,
  type FilterableSku,
} from './grid-filters.utils';
import { indexByCell } from '../../../utils/sku-attribute-value.utils';
import type { CategoryAttribute, SkuAttributeFlag, SkuAttributeValueRecord } from '../../../types';

const attr = (o: Partial<CategoryAttribute> & { id: string }): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: o.id,
  dataType: 'text',
  ...o,
});

const rec = (
  projectSkuId: string,
  attributeId: string,
  value: string | null,
): SkuAttributeValueRecord => ({
  id: `${projectSkuId}-${attributeId}`,
  projectSkuId,
  attributeId,
  value,
  unit: null,
  source: 'manual',
  updatedBy: null,
  updatedByName: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const flag = (skuId: string, attrId: string, status: 'open' | 'resolved'): SkuAttributeFlag => ({
  id: `${skuId}-${attrId}`,
  projectSkuId: skuId,
  attributeId: attrId,
  status,
  comment: '',
  flaggedBy: null,
  flaggedByName: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  resolvedAt: null,
});

const sku = (o: Partial<FilterableSku> & { id: string; skuNumber: string }): FilterableSku => ({
  projectId: null,
  isFinal: false,
  pendingExport: false,
  ...o,
});

const TEXT = attr({ id: 't' });
const REQ = attr({ id: 'r', validationRules: { required: true } });
const ENUM = attr({ id: 'e', dataType: 'enum', validationRules: { enumOptions: ['A', 'B'] } });

const IDS = ['s1', 's2', 's3'];

// ---------------------------------------------------------------------------
// activeFilterCount — what the collapsed rail has to show
// ---------------------------------------------------------------------------

describe('activeFilterCount', () => {
  it('is zero when nothing is on', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('counts every axis, so a collapsed panel cannot hide that it is filtering', () => {
    expect(
      activeFilterCount({
        search: 'hood',
        rowFilter: 'invalid',
        columnFilter: 'changed',
        flaggedOnly: true,
        valueFilters: [
          { attributeId: 't', value: 'x' },
          { attributeId: 'e', value: NO_VALUE },
        ],
      }),
    ).toBe(6);
  });

  it('ignores whitespace-only search', () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: '   ' })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Row filters
// ---------------------------------------------------------------------------

describe('rowSurvivesFilter', () => {
  const survives = (
    attribute: CategoryAttribute,
    records: SkuAttributeValueRecord[],
    filter: Parameters<typeof rowSurvivesFilter>[4],
    flags: Record<string, SkuAttributeFlag> = {},
  ) => rowSurvivesFilter(attribute, IDS, indexByCell(records), flags, filter);

  it('keeps every row under "all"', () => {
    expect(survives(TEXT, [], 'all')).toBe(true);
  });

  it('"edited" keeps a row somebody has touched, even by clearing it', () => {
    expect(survives(TEXT, [], 'edited')).toBe(false);
    expect(survives(TEXT, [rec('s1', 't', null)], 'edited')).toBe(true);
  });

  it('"required-gap" only applies to required attributes', () => {
    expect(survives(TEXT, [], 'required-gap')).toBe(false);
    expect(survives(REQ, [], 'required-gap')).toBe(true);
  });

  it('"required-gap" drops a required attribute that is fully answered', () => {
    const full = IDS.map(id => rec(id, 'r', 'x'));
    expect(survives(REQ, full, 'required-gap')).toBe(false);
  });

  it('"incomplete" and "complete" are opposites once there are SKUs', () => {
    const partial = [rec('s1', 't', 'x')];
    expect(survives(TEXT, partial, 'incomplete')).toBe(true);
    expect(survives(TEXT, partial, 'complete')).toBe(false);
    const full = IDS.map(id => rec(id, 't', 'x'));
    expect(survives(TEXT, full, 'incomplete')).toBe(false);
    expect(survives(TEXT, full, 'complete')).toBe(true);
  });

  it('"complete" is false for a category with no SKUs at all', () => {
    // "every one of zero products has a value" is true and useless; it would paint an empty
    // category entirely green.
    expect(rowSurvivesFilter(TEXT, [], new Map(), {}, 'complete')).toBe(false);
  });

  it('"invalid" finds a row where any product holds a value the attribute cannot hold', () => {
    expect(survives(ENUM, [rec('s1', 'e', 'A')], 'invalid')).toBe(false);
    expect(survives(ENUM, [rec('s1', 'e', 'Z')], 'invalid')).toBe(true);
  });

  it('"cleared" finds a deliberate blank but not an untouched cell', () => {
    expect(survives(TEXT, [], 'cleared')).toBe(false);
    expect(survives(TEXT, [rec('s1', 't', null)], 'cleared')).toBe(true);
  });

  it('"flagged" counts open flags only', () => {
    expect(survives(TEXT, [], 'flagged', { 's1::t': flag('s1', 't', 'resolved') })).toBe(false);
    expect(survives(TEXT, [], 'flagged', { 's1::t': flag('s1', 't', 'open') })).toBe(true);
  });

  it('counts an invalid value as answered for gap purposes', () => {
    // A wrong value is not a missing one — sending somebody to "fill in" a field that already
    // has something in it wastes the trip.
    const all = IDS.map(id => rec(id, 'r', 'x'));
    const requiredEnum = attr({ id: 'r', dataType: 'enum', validationRules: { required: true, enumOptions: ['A'] } });
    expect(rowSurvivesFilter(requiredEnum, IDS, indexByCell(all), {}, 'required-gap')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Column filters
// ---------------------------------------------------------------------------

describe('columnSurvivesFilter', () => {
  const DUPES = new Map([['10046631', 2], ['10047753', 1]]);
  const survives = (
    s: FilterableSku,
    filter: Parameters<typeof columnSurvivesFilter>[4],
    records: SkuAttributeValueRecord[] = [],
  ) => columnSurvivesFilter(s, [ENUM], indexByCell(records), DUPES, filter);

  it('keeps everything under "all"', () => {
    expect(survives(sku({ id: 's1', skuNumber: '10047753' }), 'all')).toBe(true);
  });

  it('"changed" keeps only SKUs with something not yet exported', () => {
    expect(survives(sku({ id: 's1', skuNumber: '1', pendingExport: true }), 'changed')).toBe(true);
    expect(survives(sku({ id: 's1', skuNumber: '1', pendingExport: false }), 'changed')).toBe(false);
  });

  it('"duplicates" keeps only item numbers that name more than one record', () => {
    expect(survives(sku({ id: 's1', skuNumber: '10046631' }), 'duplicates')).toBe(true);
    expect(survives(sku({ id: 's2', skuNumber: '10047753' }), 'duplicates')).toBe(false);
  });

  it('"no-project" finds the catalog SKUs — the population most likely to have gaps', () => {
    expect(survives(sku({ id: 's1', skuNumber: '1', projectId: null }), 'no-project')).toBe(true);
    expect(survives(sku({ id: 's1', skuNumber: '1', projectId: 'p1' }), 'no-project')).toBe(false);
  });

  it('"final" and "in-progress" split the whole set', () => {
    const s = sku({ id: 's1', skuNumber: '1', isFinal: true });
    expect(survives(s, 'final')).toBe(true);
    expect(survives(s, 'in-progress')).toBe(false);
  });

  it('"invalid" finds a SKU holding a bad value anywhere', () => {
    const s = sku({ id: 's1', skuNumber: '1' });
    expect(survives(s, 'invalid', [rec('s1', 'e', 'A')])).toBe(false);
    expect(survives(s, 'invalid', [rec('s1', 'e', 'Z')])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Value filters and the sentinel
// ---------------------------------------------------------------------------

describe('cellSurvivesValueFilter', () => {
  it('matches a substring, case-insensitively', () => {
    expect(cellSurvivesValueFilter(rec('s1', 't', 'Stainless Steel'), 'steel')).toBe(true);
    expect(cellSurvivesValueFilter(rec('s1', 't', 'Stainless Steel'), 'glass')).toBe(false);
  });

  it('NO_VALUE matches an untouched cell AND a cleared one', () => {
    // Both are "no answer here". The cell's own colour still tells them apart.
    expect(cellSurvivesValueFilter(undefined, NO_VALUE)).toBe(true);
    expect(cellSurvivesValueFilter(rec('s1', 't', null), NO_VALUE)).toBe(true);
    expect(cellSurvivesValueFilter(rec('s1', 't', '  '), NO_VALUE)).toBe(true);
    expect(cellSurvivesValueFilter(rec('s1', 't', 'x'), NO_VALUE)).toBe(false);
  });

  it('is not the same as an empty filter string', () => {
    // A blank in a <select> means "no option chosen", so it must not filter at all — otherwise
    // "off" and "show me the blanks" would be the same thing.
    expect(cellSurvivesValueFilter(rec('s1', 't', 'x'), '')).toBe(true);
    expect(cellSurvivesValueFilter(rec('s1', 't', 'x'), '   ')).toBe(true);
  });

  it('treats a missing record as empty text for a substring filter', () => {
    expect(cellSurvivesValueFilter(undefined, 'steel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('summarise', () => {
  const SKUS = [
    sku({ id: 's1', skuNumber: '10046631', projectId: null }),
    sku({ id: 's2', skuNumber: '10046631', projectId: 'p1' }),
    sku({ id: 's3', skuNumber: '10047753', projectId: 'p1' }),
  ];
  const DUPES = new Map([['10046631', 2], ['10047753', 1]]);

  it('counts cells, coverage, gaps, invalids, duplicates and catalog SKUs', () => {
    const s = summarise(
      SKUS,
      [REQ, ENUM],
      indexByCell([
        rec('s1', 'r', 'x'),
        rec('s2', 'r', 'y'),
        // s3 has no required value → one gap
        rec('s1', 'e', 'Z'), // invalid, but still counts as answered
      ]),
      DUPES,
    );
    expect(s).toMatchObject({
      skus: 3,
      attributes: 2,
      totalCells: 6,
      filledCells: 3,
      coveragePercent: 50,
      requiredGaps: 1,
      invalidCells: 1,
      duplicateRecords: 2,
      withoutProject: 1,
    });
  });

  it('does not divide by zero on an empty category', () => {
    expect(summarise([], [], new Map(), new Map())).toMatchObject({
      totalCells: 0,
      coveragePercent: 0,
    });
  });

  it('reports 100% only when every cell is answered', () => {
    const full = indexByCell(
      SKUS.flatMap(s => [rec(s.id, 'r', 'x'), rec(s.id, 'e', 'A')]),
    );
    expect(summarise(SKUS, [REQ, ENUM], full, DUPES).coveragePercent).toBe(100);
  });
});
