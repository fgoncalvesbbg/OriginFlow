/**
 * Pure grid maths for the Attribute Viewer — cluster banding, column sorting, column paging
 * and keyboard navigation.
 *
 * No React, no `db`, no fetch. ProductToolkit's "pure `lib/`" rule, and the reason their grid
 * stayed maintainable at 115 × 71: "why is this column here / in this position / why did Tab
 * go there" is each answerable by reading one function, with fixtures pinning it.
 *
 * Phase 2 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import type { CategoryAttribute, SkuAttributeValueRecord } from '../../../types';
import { groupsInOrder } from '../../../config/compliance.constants';
import { cellKey } from '../../../utils/sku-attribute-value.utils';

/**
 * How many SKU columns to reveal at a time. PT's number, chosen as "about two screens wide":
 * a category is up to ~140 SKUs × ~67 attributes, and rendering all of it costs ~9,000 cells
 * for a grid nobody can see more than a fraction of.
 */
export const COLUMNS_PER_PAGE = 25;

// ─────────────────────────────────────────────────────────────────────────────────────
// Cluster bands
// ─────────────────────────────────────────────────────────────────────────────────────

export interface ClusterBand {
  group: string;
  attributes: CategoryAttribute[];
}

/**
 * Split already-sorted attribute rows into their cluster bands, in display order.
 *
 * Order comes from `groupsInOrder` — first appearance in the sorted list — rather than from
 * iterating a registry of known groups. That is deliberate: a ProductToolkit cluster is not
 * registered in `ATTRIBUTE_GROUPS`, and iterating the registry would silently DROP every row
 * in an unregistered cluster. A dropped row here is invisible, which is the worst kind of bug
 * this screen can have.
 *
 * A full-width band row is a real, collapsible section heading — which is the second reason
 * the grid is transposed. Above 70 columns a `colspan` band was only a label.
 */
export const buildClusterBands = (attributes: readonly CategoryAttribute[]): ClusterBand[] => {
  const byGroup = new Map<string, CategoryAttribute[]>();
  for (const a of attributes) {
    const group = a.group || 'Category Specific';
    const list = byGroup.get(group);
    if (list) list.push(a);
    else byGroup.set(group, [a]);
  }
  // groupsInOrder takes a mutable array and only reads `group`; copy rather than cast.
  return groupsInOrder(attributes.map(a => ({ group: a.group }))).map(group => ({
    group,
    attributes: byGroup.get(group) ?? [],
  }));
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Sorting columns by an attribute row
// ─────────────────────────────────────────────────────────────────────────────────────

export type SortDirection = 'asc' | 'desc';

export interface GridSort {
  attributeId: string;
  direction: SortDirection;
}

/**
 * Clicking an attribute row cycles asc → desc → off. `null` means "off", and returning to it
 * rather than sticking on desc matters: a sort applied by accident has to be removable by the
 * same gesture that applied it.
 */
export const nextSort = (current: GridSort | null, attributeId: string): GridSort | null => {
  if (!current || current.attributeId !== attributeId) return { attributeId, direction: 'asc' };
  if (current.direction === 'asc') return { attributeId, direction: 'desc' };
  return null;
};

/** Numeric when both sides parse as numbers, so `9` sorts below `10` instead of above it. */
const compareValues = (a: string, b: string, numeric: boolean): number => {
  if (numeric) {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Order SKU columns by one attribute's values.
 *
 * **Blanks always sort last, in BOTH directions.** Descending does not mean "put the empty
 * ones first" — somebody sorting by air flow wants the products that have an air flow, and
 * flipping the direction to see the largest should not fill the first screen with gaps. A
 * cleared cell counts as blank here: it has no value to order by.
 *
 * The comparison is type-aware, so a metric sorts on its number rather than as text.
 * Ties fall back to SKU number, so the order is stable and does not shuffle between renders.
 */
export const sortSkusByAttribute = <T extends { id: string; skuNumber: string }>(
  skus: readonly T[],
  attribute: CategoryAttribute,
  direction: SortDirection,
  byCell: Map<string, SkuAttributeValueRecord>,
): T[] => {
  const numeric = attribute.dataType === 'integer' || attribute.dataType === 'decimal';
  const valueOf = (sku: T): string => {
    const v = byCell.get(cellKey(sku.id, attribute.id))?.value;
    return v === null || v === undefined ? '' : v.trim();
  };

  return skus.slice().sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va === '' && vb === '') {
      return a.skuNumber.localeCompare(b.skuNumber, undefined, { numeric: true });
    }
    if (va === '') return 1; // blanks last regardless of direction
    if (vb === '') return -1;
    const cmp = compareValues(va, vb, numeric);
    if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    return a.skuNumber.localeCompare(b.skuNumber, undefined, { numeric: true });
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Column paging
// ─────────────────────────────────────────────────────────────────────────────────────

export interface ColumnPage<T> {
  columns: T[];
  page: number;
  pageCount: number;
  /** True when paging is off because every column is shown. */
  showingAll: boolean;
}

/**
 * The slice of SKU columns to render.
 *
 * `comparing` short-circuits paging: somebody who ticked five products wants those five, not
 * "the first 25 of your 5". Same for a set small enough to fit in one page — then the pager
 * should not appear at all.
 */
export const pageColumns = <T>(
  skus: readonly T[],
  page: number,
  options: { comparing?: boolean; pageSize?: number } = {},
): ColumnPage<T> => {
  const pageSize = options.pageSize ?? COLUMNS_PER_PAGE;
  if (options.comparing || skus.length <= pageSize) {
    return { columns: skus.slice(), page: 0, pageCount: 1, showingAll: true };
  }
  const pageCount = Math.ceil(skus.length / pageSize);
  // Clamp rather than return empty: a filter that shrinks the set while you are on page 4
  // should land you on the last page, not on a blank grid.
  const safe = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    columns: skus.slice(safe * pageSize, safe * pageSize + pageSize),
    page: safe,
    pageCount,
    showingAll: false,
  };
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Keyboard navigation
// ─────────────────────────────────────────────────────────────────────────────────────

/** A cell's position in the rendered grid: which attribute row, which SKU column. */
export interface CellPosition {
  row: number;
  col: number;
}

export type GridKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Enter'
  | 'Tab'
  | 'ShiftTab';

/**
 * Where a key takes the selection.
 *
 * The two that carry the spreadsheet feel, and the reason they differ:
 *
 *  - `Enter` moves **DOWN** — to the next attribute of the SAME product. Filling in one
 *    product means answering question after question about it.
 *  - `Tab` moves **ACROSS** — to the next product, SAME attribute. Answering one question
 *    across the category is reading along a single line.
 *
 * Movement clamps at the edges rather than wrapping. Wrapping from the last column of one row
 * to the first of the next is disorienting in a grid this wide: the selection jumps most of a
 * screen sideways and the reason is invisible. `null` means "no move" and the caller leaves
 * the selection where it is.
 */
export const nextCell = (
  current: CellPosition,
  key: GridKey,
  bounds: { rows: number; cols: number },
): CellPosition | null => {
  if (bounds.rows === 0 || bounds.cols === 0) return null;
  const clampRow = (r: number) => Math.min(Math.max(r, 0), bounds.rows - 1);
  const clampCol = (c: number) => Math.min(Math.max(c, 0), bounds.cols - 1);

  switch (key) {
    case 'ArrowUp':
      return { ...current, row: clampRow(current.row - 1) };
    case 'ArrowDown':
    case 'Enter':
      return { ...current, row: clampRow(current.row + 1) };
    case 'ArrowLeft':
      return { ...current, col: clampCol(current.col - 1) };
    case 'ArrowRight':
    case 'Tab':
      return { ...current, col: clampCol(current.col + 1) };
    case 'ShiftTab':
      return { ...current, col: clampCol(current.col - 1) };
    default:
      return null;
  }
};

/**
 * The flat list of attribute rows in rendered order, skipping collapsed bands.
 *
 * Keyboard navigation has to walk what is ON SCREEN, not the full definition — otherwise
 * `Enter` from the last visible row of an expanded band lands on a row inside a collapsed one
 * and the selection disappears.
 */
export const visibleRows = (
  bands: readonly ClusterBand[],
  collapsed: ReadonlySet<string>,
): CategoryAttribute[] =>
  bands.flatMap(band => (collapsed.has(band.group) ? [] : band.attributes));
