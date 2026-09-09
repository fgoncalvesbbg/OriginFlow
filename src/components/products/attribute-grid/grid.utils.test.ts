import { describe, it, expect } from 'vitest';
import {
  COLUMNS_PER_PAGE,
  buildClusterBands,
  nextCell,
  nextSort,
  pageColumns,
  sortSkusByAttribute,
  visibleRows,
} from './grid.utils';
import { indexByCell } from '../../../utils/sku-attribute-value.utils';
import type { CategoryAttribute, SkuAttributeValueRecord } from '../../../types';

const attr = (
  overrides: Partial<CategoryAttribute> & { id: string },
): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: overrides.id,
  dataType: 'text',
  ...overrides,
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

const sku = (id: string, skuNumber: string) => ({ id, skuNumber });

// ---------------------------------------------------------------------------
// Cluster bands
// ---------------------------------------------------------------------------

describe('buildClusterBands', () => {
  it('bands rows by group in first-appearance order', () => {
    const bands = buildClusterBands([
      attr({ id: 'a', group: 'Product Dimensions' }),
      attr({ id: 'b', group: 'Product Dimensions' }),
      attr({ id: 'c', group: 'Packaging' }),
    ]);
    expect(bands.map(b => b.group)).toEqual(['Product Dimensions', 'Packaging']);
    expect(bands[0].attributes.map(a => a.id)).toEqual(['a', 'b']);
  });

  it('keeps a group that is not in ATTRIBUTE_GROUPS', () => {
    // A ProductToolkit cluster is not registered anywhere. Iterating the registry instead of
    // first appearance would silently DROP every row in it — invisible, and the worst bug
    // this screen can have.
    const bands = buildClusterBands([
      attr({ id: 'a', group: 'PERFORMANCE' }),
      attr({ id: 'b', group: 'Packaging' }),
    ]);
    expect(bands.map(b => b.group)).toEqual(['PERFORMANCE', 'Packaging']);
    expect(bands.flatMap(b => b.attributes)).toHaveLength(2);
  });

  it('loses no rows, whatever the groups are', () => {
    const rows = [
      attr({ id: 'a', group: 'X' }),
      attr({ id: 'b' }),
      attr({ id: 'c', group: 'X' }),
      attr({ id: 'd', group: 'Y' }),
    ];
    expect(buildClusterBands(rows).flatMap(b => b.attributes)).toHaveLength(rows.length);
  });

  it('treats a missing group as Category Specific', () => {
    expect(buildClusterBands([attr({ id: 'a' })])[0].group).toBe('Category Specific');
  });

  it('handles no rows', () => {
    expect(buildClusterBands([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sort cycling
// ---------------------------------------------------------------------------

describe('nextSort', () => {
  it('cycles asc → desc → off on the same row', () => {
    const first = nextSort(null, 'a');
    expect(first).toEqual({ attributeId: 'a', direction: 'asc' });
    const second = nextSort(first, 'a');
    expect(second).toEqual({ attributeId: 'a', direction: 'desc' });
    // Off, so a sort applied by accident comes off with the same gesture that applied it.
    expect(nextSort(second, 'a')).toBeNull();
  });

  it('starts fresh at asc when a different row is clicked', () => {
    expect(nextSort({ attributeId: 'a', direction: 'desc' }, 'b'))
      .toEqual({ attributeId: 'b', direction: 'asc' });
  });
});

// ---------------------------------------------------------------------------
// Sorting columns
// ---------------------------------------------------------------------------

describe('sortSkusByAttribute', () => {
  const AIRFLOW = attr({ id: 'air', dataType: 'integer' });
  const skus = [sku('s1', '101'), sku('s2', '102'), sku('s3', '103'), sku('s4', '104')];
  const byCell = indexByCell([
    rec('s1', 'air', '650'),
    rec('s2', 'air', '90'),
    rec('s3', 'air', ''),      // blank
    rec('s4', 'air', '671'),
  ]);

  it('sorts numerically, not lexically', () => {
    expect(sortSkusByAttribute(skus, AIRFLOW, 'asc', byCell).map(s => s.id))
      .toEqual(['s2', 's1', 's4', 's3']);
  });

  it('puts blanks last ASCENDING', () => {
    expect(sortSkusByAttribute(skus, AIRFLOW, 'asc', byCell).at(-1)!.id).toBe('s3');
  });

  it('puts blanks last DESCENDING too', () => {
    // Flipping direction to see the largest must not fill the first screen with gaps.
    expect(sortSkusByAttribute(skus, AIRFLOW, 'desc', byCell).map(s => s.id))
      .toEqual(['s4', 's1', 's2', 's3']);
  });

  it('treats a cleared cell as blank — there is no value to order by', () => {
    const cleared = indexByCell([rec('s1', 'air', '5'), rec('s2', 'air', null)]);
    const order = sortSkusByAttribute([sku('s1', '1'), sku('s2', '2')], AIRFLOW, 'desc', cleared);
    expect(order.map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('treats a SKU with no record at all as blank', () => {
    const order = sortSkusByAttribute(
      [sku('s1', '1'), sku('sX', '2')],
      AIRFLOW,
      'asc',
      indexByCell([rec('s1', 'air', '5')]),
    );
    expect(order.map(s => s.id)).toEqual(['s1', 'sX']);
  });

  it('sorts text case-insensitively', () => {
    const COLOR = attr({ id: 'c' });
    const order = sortSkusByAttribute(
      [sku('s1', '1'), sku('s2', '2'), sku('s3', '3')],
      COLOR,
      'asc',
      indexByCell([rec('s1', 'c', 'silver'), rec('s2', 'c', 'Black'), rec('s3', 'c', 'white')]),
    );
    expect(order.map(s => s.id)).toEqual(['s2', 's1', 's3']);
  });

  it('breaks ties on SKU number so the order is stable', () => {
    const order = sortSkusByAttribute(
      [sku('b', '200'), sku('a', '100')],
      AIRFLOW,
      'asc',
      indexByCell([rec('a', 'air', '5'), rec('b', 'air', '5')]),
    );
    expect(order.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input', () => {
    const input = [sku('s1', '101'), sku('s2', '102')];
    const before = input.map(s => s.id);
    sortSkusByAttribute(input, AIRFLOW, 'desc', byCell);
    expect(input.map(s => s.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Column paging
// ---------------------------------------------------------------------------

describe('pageColumns', () => {
  const many = Array.from({ length: 138 }, (_, i) => sku(`s${i}`, String(i)));

  it('reveals one page at a time', () => {
    const page = pageColumns(many, 0);
    expect(page.columns).toHaveLength(COLUMNS_PER_PAGE);
    expect(page.pageCount).toBe(6);
    expect(page.showingAll).toBe(false);
  });

  it('gives the requested page', () => {
    expect(pageColumns(many, 2).columns[0].id).toBe(`s${COLUMNS_PER_PAGE * 2}`);
  });

  it('leaves a short last page short', () => {
    expect(pageColumns(many, 5).columns).toHaveLength(138 - COLUMNS_PER_PAGE * 5);
  });

  it('clamps a page past the end rather than showing a blank grid', () => {
    // A filter that shrinks the set while you are on page 4 should land you on the last page.
    const page = pageColumns(many, 99);
    expect(page.page).toBe(5);
    expect(page.columns.length).toBeGreaterThan(0);
  });

  it('turns paging off when everything fits', () => {
    const few = many.slice(0, 10);
    expect(pageColumns(few, 0)).toMatchObject({ pageCount: 1, showingAll: true });
    expect(pageColumns(few, 0).columns).toHaveLength(10);
  });

  it('ignores paging while comparing — five ticked products means those five', () => {
    const page = pageColumns(many, 3, { comparing: true });
    expect(page.columns).toHaveLength(138);
    expect(page.showingAll).toBe(true);
  });

  it('handles an empty set', () => {
    expect(pageColumns([], 0)).toMatchObject({ columns: [], pageCount: 1, showingAll: true });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

describe('nextCell', () => {
  const bounds = { rows: 4, cols: 3 };
  const at = { row: 1, col: 1 };

  it('Enter moves DOWN — the next attribute of the same product', () => {
    expect(nextCell(at, 'Enter', bounds)).toEqual({ row: 2, col: 1 });
  });

  it('Tab moves ACROSS — the next product, same attribute', () => {
    expect(nextCell(at, 'Tab', bounds)).toEqual({ row: 1, col: 2 });
  });

  it('Shift+Tab moves back across', () => {
    expect(nextCell(at, 'ShiftTab', bounds)).toEqual({ row: 1, col: 0 });
  });

  it('arrows move one step each way', () => {
    expect(nextCell(at, 'ArrowUp', bounds)).toEqual({ row: 0, col: 1 });
    expect(nextCell(at, 'ArrowDown', bounds)).toEqual({ row: 2, col: 1 });
    expect(nextCell(at, 'ArrowLeft', bounds)).toEqual({ row: 1, col: 0 });
    expect(nextCell(at, 'ArrowRight', bounds)).toEqual({ row: 1, col: 2 });
  });

  it('clamps at the edges instead of wrapping', () => {
    // Wrapping in a 70-column grid throws the selection most of a screen sideways for a
    // reason the reader cannot see.
    expect(nextCell({ row: 0, col: 0 }, 'ArrowUp', bounds)).toEqual({ row: 0, col: 0 });
    expect(nextCell({ row: 0, col: 0 }, 'ShiftTab', bounds)).toEqual({ row: 0, col: 0 });
    expect(nextCell({ row: 3, col: 2 }, 'Enter', bounds)).toEqual({ row: 3, col: 2 });
    expect(nextCell({ row: 3, col: 2 }, 'Tab', bounds)).toEqual({ row: 3, col: 2 });
  });

  it('does nothing in an empty grid', () => {
    expect(nextCell(at, 'Enter', { rows: 0, cols: 0 })).toBeNull();
    expect(nextCell(at, 'Tab', { rows: 4, cols: 0 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// visibleRows
// ---------------------------------------------------------------------------

describe('visibleRows', () => {
  const bands = buildClusterBands([
    attr({ id: 'a', group: 'Dims' }),
    attr({ id: 'b', group: 'Dims' }),
    attr({ id: 'c', group: 'Perf' }),
  ]);

  it('walks every row when nothing is collapsed', () => {
    expect(visibleRows(bands, new Set()).map(a => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips the rows of a collapsed band', () => {
    // Otherwise Enter from the last visible row lands inside a collapsed band and the
    // selection vanishes.
    expect(visibleRows(bands, new Set(['Dims'])).map(a => a.id)).toEqual(['c']);
  });

  it('returns nothing when every band is collapsed', () => {
    expect(visibleRows(bands, new Set(['Dims', 'Perf']))).toEqual([]);
  });
});
