/**
 * Pure filter logic for the Attribute Viewer.
 *
 * Two axes, kept apart on purpose:
 *  - a **row filter** hides attribute rows ("show me only the required ones with a gap")
 *  - a **column filter** hides SKU columns ("show me only the ones I have not exported")
 *
 * Collapsing them into one list reads simpler and is wrong: "invalid" as a row filter means
 * "attributes where some product has a bad value", and as a column filter it means "products
 * with a bad value somewhere". Those are different questions and both get asked.
 *
 * Phase 4 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import type {
  CategoryAttribute,
  SkuAttributeFlag,
  SkuAttributeValueRecord,
} from '../../../types';
import { cellKey, classifyCell, isFilled } from '../../../utils/sku-attribute-value.utils';

/**
 * "No value" as a filter choice.
 *
 * Spelled out rather than represented by an empty string, because in a `<select>` a blank
 * option value is indistinguishable from "no option chosen" — so a filter for *absence* and a
 * filter that is *off* would be the same thing, and one of them would silently win.
 */
export const NO_VALUE = '__no_value__';

export type RowFilter =
  | 'all'
  | 'edited'
  | 'required-gap'
  | 'incomplete'
  | 'complete'
  | 'invalid'
  | 'flagged'
  | 'cleared';

export type ColumnFilter =
  | 'all'
  | 'changed'
  | 'duplicates'
  | 'no-project'
  | 'final'
  | 'in-progress'
  | 'invalid';

export interface ValueFilter {
  attributeId: string;
  /** A substring to match, or `NO_VALUE` for "this cell has nothing in it". */
  value: string;
}

export interface GridFilterState {
  search: string;
  rowFilter: RowFilter;
  columnFilter: ColumnFilter;
  valueFilters: ValueFilter[];
  flaggedOnly: boolean;
}

export const EMPTY_FILTERS: GridFilterState = {
  search: '',
  rowFilter: 'all',
  columnFilter: 'all',
  valueFilters: [],
  flaggedOnly: false,
};

/**
 * How many filters are on.
 *
 * This number is the whole reason the filter panel can collapse: a collapsed panel must never
 * be able to hide the fact that it is filtering, so the rail carries this count.
 */
export const activeFilterCount = (s: GridFilterState): number =>
  (s.search.trim() !== '' ? 1 : 0) +
  (s.rowFilter !== 'all' ? 1 : 0) +
  (s.columnFilter !== 'all' ? 1 : 0) +
  (s.flaggedOnly ? 1 : 0) +
  s.valueFilters.length;

/** Human labels, so the rail and the chips read the same words. */
export const ROW_FILTER_LABELS: Record<RowFilter, string> = {
  all: 'All attributes',
  edited: 'Someone has filled these',
  'required-gap': 'Required, with a gap',
  incomplete: 'Not complete',
  complete: 'Complete',
  invalid: 'Has an invalid value',
  flagged: 'Has an open flag',
  cleared: 'Has a deliberate blank',
};

export const COLUMN_FILTER_LABELS: Record<ColumnFilter, string> = {
  all: 'All SKUs',
  changed: 'Changed since last export',
  duplicates: 'Item number names 2+ records',
  'no-project': 'Not in any project',
  final: 'Final',
  'in-progress': 'In progress',
  invalid: 'Has an invalid value',
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Does this attribute row survive the row filter, judged across the given SKUs?
 *
 * Every filter here asks about the row as a WHOLE — "does any product have an invalid value
 * for this attribute" — because the unit being hidden or kept is the row.
 *
 * `complete` is deliberately false for a category with no SKUs: "every one of zero products
 * has a value" is technically true and useless, and it would show a full grid of green on an
 * empty category.
 */
export const rowSurvivesFilter = (
  attribute: CategoryAttribute,
  skuIds: readonly string[],
  byCell: Map<string, SkuAttributeValueRecord>,
  flagMap: Record<string, SkuAttributeFlag>,
  filter: RowFilter,
): boolean => {
  if (filter === 'all') return true;

  let filledCount = 0;
  let hasRecord = false;
  let hasInvalid = false;
  let hasCleared = false;
  let hasOpenFlag = false;

  for (const skuId of skuIds) {
    const key = cellKey(skuId, attribute.id);
    const record = byCell.get(key);
    if (record) hasRecord = true;
    const state = classifyCell(record, attribute);
    if (state === 'invalid') hasInvalid = true;
    if (state === 'cleared') hasCleared = true;
    if (isFilled(record, attribute)) filledCount += 1;
    if (flagMap[key]?.status === 'open') hasOpenFlag = true;
  }

  switch (filter) {
    case 'edited':
      return hasRecord;
    case 'required-gap':
      return attribute.validationRules?.required === true && filledCount < skuIds.length;
    case 'incomplete':
      return filledCount < skuIds.length;
    case 'complete':
      return skuIds.length > 0 && filledCount === skuIds.length;
    case 'invalid':
      return hasInvalid;
    case 'cleared':
      return hasCleared;
    case 'flagged':
      return hasOpenFlag;
    default:
      return true;
  }
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────────────────────────

/** Just enough of a SKU for the column filters to decide. */
export interface FilterableSku {
  id: string;
  skuNumber: string;
  projectId: string | null;
  isFinal: boolean;
  pendingExport: boolean;
}

export const columnSurvivesFilter = (
  sku: FilterableSku,
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
  duplicateCounts: Map<string, number>,
  filter: ColumnFilter,
): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'changed':
      return sku.pendingExport;
    case 'duplicates':
      return (duplicateCounts.get(sku.skuNumber) ?? 1) > 1;
    case 'no-project':
      return sku.projectId === null;
    case 'final':
      return sku.isFinal;
    case 'in-progress':
      return !sku.isFinal;
    case 'invalid':
      return attributes.some(
        a => classifyCell(byCell.get(cellKey(sku.id, a.id)), a) === 'invalid',
      );
    default:
      return true;
  }
};

/**
 * Does this cell satisfy a per-attribute value filter?
 *
 * `NO_VALUE` matches a cell with nothing in it — which includes both a cell nobody has touched
 * and one deliberately cleared. That is the right grouping for a filter: somebody asking "which
 * products have no answer here" wants both, and the cell's own colour still tells them apart.
 */
export const cellSurvivesValueFilter = (
  record: SkuAttributeValueRecord | undefined,
  filterValue: string,
): boolean => {
  const stored = record?.value;
  if (filterValue === NO_VALUE) return stored === null || stored === undefined || stored.trim() === '';
  const needle = filterValue.trim().toLowerCase();
  if (needle === '') return true;
  return (stored ?? '').toLowerCase().includes(needle);
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Summary tiles
// ─────────────────────────────────────────────────────────────────────────────────────

export interface GridSummary {
  skus: number;
  attributes: number;
  /** Filled cells over total cells, as a percentage rounded to a whole number. */
  coveragePercent: number;
  filledCells: number;
  totalCells: number;
  requiredGaps: number;
  invalidCells: number;
  duplicateRecords: number;
  withoutProject: number;
}

/**
 * The numbers the summary tiles show.
 *
 * Computed over the whole category rather than the filtered view, because a tile is how you
 * GET to a filtered view — showing the filtered count would make each tile describe the state
 * it put you in rather than the state you might want to go to next.
 */
export const summarise = (
  skus: readonly FilterableSku[],
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
  duplicateCounts: Map<string, number>,
): GridSummary => {
  let filledCells = 0;
  let invalidCells = 0;
  let requiredGaps = 0;

  for (const attribute of attributes) {
    const required = attribute.validationRules?.required === true;
    for (const sku of skus) {
      const record = byCell.get(cellKey(sku.id, attribute.id));
      const filled = isFilled(record, attribute);
      if (filled) filledCells += 1;
      if (classifyCell(record, attribute) === 'invalid') invalidCells += 1;
      if (required && !filled) requiredGaps += 1;
    }
  }

  const totalCells = skus.length * attributes.length;
  return {
    skus: skus.length,
    attributes: attributes.length,
    totalCells,
    filledCells,
    coveragePercent: totalCells === 0 ? 0 : Math.round((filledCells / totalCells) * 100),
    requiredGaps,
    invalidCells,
    duplicateRecords: skus.filter(s => (duplicateCounts.get(s.skuNumber) ?? 1) > 1).length,
    withoutProject: skus.filter(s => s.projectId === null).length,
  };
};
