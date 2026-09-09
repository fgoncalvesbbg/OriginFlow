/**
 * Parser for a "SKU values" sheet, in EITHER of the two orientations real sheets arrive in.
 *
 *  - **transposed** — one row per ATTRIBUTE, one column per SKU. The header row holds the SKU
 *    numbers (after any leading label column(s)); each body row starts with an attribute
 *    identifier (Akeneo code or name) and then its value for each SKU column. An optional
 *    "title" row supplies SKU titles. This is what `prepare-category-import` emits.
 *  - **wide** — one row per SKU, one column per ATTRIBUTE. This is the shape every category
 *    review sheet actually has (see docs/attributes-island-hoods-2026-09-09.csv): a section
 *    row above the header row, then `SKU | Description | Brand | <attribute> …` with the SKUs
 *    down the side. Nobody transposes 138 columns by hand, so refusing this shape meant the
 *    only way to load a category's values in bulk was to not load them at all.
 *
 * Orientation is DETECTED, not asked for, by counting which axis holds item numbers — and the
 * caller can override the guess, because a sheet whose SKU identifiers are not numeric gives
 * the detector nothing to go on.
 *
 * Columns/rows are matched to a category's attributes by Akeneo code first, then by name, then
 * by a punctuation-insensitive form of the name. Pure and unit-testable; the DB upsert lives in
 * sku-catalog.service.ts (bulkUpsertCatalogSkus).
 */
import * as XLSX from 'xlsx';
import type { CategoryAttribute, SkuAttributeValue } from '../types';

/** Which axis the SKUs are on. */
export type SkuSheetOrientation = 'transposed' | 'wide';

export interface SkuCsvSkuColumn {
  /** Grid position this SKU was read from: a COLUMN index when transposed, a ROW index when wide. */
  index: number;
  skuNumber: string;
  skuTitle: string;
}

export interface SkuCsvAttributeRow {
  label: string;
  matched: boolean;
  attributeId?: string;
  attributeName?: string;
}

/** Per-SKU upsert payload (the shape bulkUpsertCatalogSkus consumes). */
export interface SkuCsvRow {
  skuNumber: string;
  skuTitle: string;
  values: SkuAttributeValue[];
  flags: string[];
}

export interface SkuCsvParseResult {
  skus: SkuCsvSkuColumn[];
  attributes: SkuCsvAttributeRow[];
  rows: SkuCsvRow[];
  /** How the sheet was read — surfaced so the preview can say so and offer to switch. */
  orientation: SkuSheetOrientation;
  /** True when `orientation` came from the caller rather than from detection. */
  orientationForced: boolean;
  /**
   * Headers skipped on purpose: the "— in Akeneo" / "— in EPREL" mirror columns a review sheet
   * carries next to each attribute. They record what the OTHER system currently holds, so
   * importing them would overwrite our own value with a comparison. Named rather than silently
   * dropped, so "138 columns in, 47 attributes matched" is an accountable number.
   */
  ignoredColumns: string[];
}

/** Caller-side knobs. `orientation: 'auto'` (the default) detects it. */
export interface ParseSkuCsvOptions {
  orientation?: SkuSheetOrientation | 'auto';
}

const norm = (s: any) => String(s ?? '').trim().toLowerCase();

/**
 * Punctuation-insensitive key for the LAST matching tier. Real sheets and the app disagree over
 * trailing question marks, brackets and superscripts — "Grease Filter dishwasher safe?" vs the
 * same name without it, "Airflow (m³/h) max" vs "(m3/h)". Superscripts fold to their digit
 * first, because stripping them instead would make m³ and m collide.
 */
const loose = (s: any) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/[^a-z0-9]+/g, '');

// Header tokens for the leading label column(s) (not SKU columns), and for the optional
// SKU-title row/column (matched on its label).
const LABEL_HEADERS = new Set(['', 'attribute', 'attributes', 'code', 'akeneo', 'akeneo code', 'name', 'field', 'sku', 'attribute name']);
const TITLE_LABELS = new Set(['title', 'sku title', 'sku_title', 'name', 'product name', 'product_name', 'description']);

/** Headers that name the SKU column of a WIDE sheet. */
const SKU_HEADERS = new Set([
  'sku', 'skus', 'sku number', 'sku no', 'sku no.', 'sku_number', 'sku-nr', 'sku nr',
  'item', 'item number', 'item no', 'item no.', 'item_number',
  'article', 'article number', 'article no', 'artikelnummer', 'material', 'model',
]);

/**
 * A review sheet's comparison mirrors. These sit BESIDE the attribute they mirror and hold the
 * other system's value, not ours.
 */
const REFERENCE_SUFFIX = /\s*[—–-]{1,2}\s*(in|from|per)\s+(akeneo|eprel)\s*$/i;

/** Does this cell look like an item number? The whole orientation guess rests on this. */
const looksLikeItemNumber = (s: any): boolean => {
  const t = String(s ?? '').trim();
  if (!t) return false;
  if (!/^[0-9][0-9 ._\-/]*$/.test(t)) return false;
  return t.replace(/\D/g, '').length >= 4;
};

function normalizeBoolean(raw: string): string | null {
  const v = norm(raw);
  if (['yes', 'y', 'true', '1', 'x'].includes(v)) return 'true';
  if (['no', 'n', 'false', '0'].includes(v)) return 'false';
  return null;
}

// ---------------------------------------------------------------------------------------
// Shared between the two orientations, so a value read down a column and the same value read
// across a row can never be coerced or matched differently.
// ---------------------------------------------------------------------------------------

interface AttributeIndex {
  /** First match wins across the labels given, in tiers: code, then name, then loose name. */
  match: (labels: readonly string[]) => CategoryAttribute | undefined;
}

function buildAttributeIndex(attributes: readonly CategoryAttribute[]): AttributeIndex {
  const byCode = new Map<string, CategoryAttribute>();
  const byName = new Map<string, CategoryAttribute>();
  const byLoose = new Map<string, CategoryAttribute>();
  for (const a of attributes) {
    if (a.akeneoId) byCode.set(norm(a.akeneoId), a);
    byName.set(norm(a.name), a);
    // First definition wins: two attributes whose names differ only in punctuation are a
    // definition problem, and quietly preferring the later one would hide it.
    if (a.akeneoId && !byLoose.has(loose(a.akeneoId))) byLoose.set(loose(a.akeneoId), a);
    if (!byLoose.has(loose(a.name))) byLoose.set(loose(a.name), a);
  }
  return {
    match: labels => {
      for (const l of labels) {
        const hit = byCode.get(norm(l)) ?? byName.get(norm(l));
        if (hit) return hit;
      }
      for (const l of labels) {
        const hit = byLoose.get(loose(l));
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

/**
 * Coerce one cell for one attribute, pushing any complaint onto `flags`.
 * Returns the value to store — the raw cell when validation fails, because a cell the
 * definition rejects is still what the sheet says and the flag is what tells the operator
 * to look at it.
 */
function coerceCell(attr: CategoryAttribute, cell: string, flags: string[]): string {
  if (attr.dataType === 'boolean') {
    const b = normalizeBoolean(cell);
    if (b === null) flags.push(`${attr.name}: "${cell}" is not a yes/no value`);
    else return b;
  } else if (attr.dataType === 'enum') {
    const opts = attr.validationRules?.enumOptions ?? [];
    if (opts.length > 0 && !opts.some(o => norm(o) === norm(cell))) {
      flags.push(`${attr.name}: "${cell}" is not one of the allowed options`);
    }
  } else if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
    if (isNaN(Number(cell.replace(',', '.')))) flags.push(`${attr.name}: "${cell}" is not a number`);
  }
  return cell;
}

const isBlankRow = (r: any[] | undefined) => !r || r.every(c => String(c ?? '').trim() === '');

/**
 * Where a WIDE sheet's header row is: the first row within the lead-in whose first few cells
 * name the SKU column. A review sheet puts a section row ("1 . Category Specific Attributes"…)
 * ABOVE the header, so "the first non-empty row" is the wrong answer for this shape.
 */
function findWideHeaderRow(grid: any[][]): number {
  const limit = Math.min(grid.length, 12);
  for (let i = 0; i < limit; i++) {
    const row = grid[i];
    if (!row) continue;
    for (let j = 0; j < Math.min(row.length, 4); j++) {
      if (SKU_HEADERS.has(norm(row[j]))) return i;
    }
  }
  return -1;
}

/**
 * Decide which way round the sheet is by counting item numbers on each axis.
 *
 * A transposed sheet has them along the header row; a wide one has them down the SKU column.
 * Ties go to `transposed` — that keeps every sheet that parsed before this function existed
 * parsing the same way, including the ambiguous case of a sheet with no numeric identifiers at
 * all, which is why the caller can force the answer.
 */
function detectOrientation(grid: any[][], firstRow: number, wideHeaderRow: number): SkuSheetOrientation {
  const header = grid[firstRow] ?? [];
  const transposedScore = header.slice(1).filter(looksLikeItemNumber).length;

  const wideHeaderIdx = wideHeaderRow === -1 ? firstRow : wideHeaderRow;
  const wideHeader = grid[wideHeaderIdx] ?? [];
  let skuCol = wideHeader.findIndex(c => SKU_HEADERS.has(norm(c)));
  if (skuCol === -1) skuCol = 0;
  let wideScore = 0;
  for (let i = wideHeaderIdx + 1; i < grid.length; i++) {
    if (looksLikeItemNumber(grid[i]?.[skuCol])) wideScore++;
  }

  return wideScore > transposedScore ? 'wide' : 'transposed';
}

// ---------------------------------------------------------------------------------------

/**
 * Parse a SKU values sheet against a category's attribute set.
 * @param input      CSV/XLSX buffer (browser) or string (tests).
 * @param attributes The attributes of the target category (from getAttributesForCategory).
 * @param options    `orientation` forces the axis instead of detecting it.
 */
export function parseSkuCsv(
  input: ArrayBuffer | Uint8Array | string,
  attributes: CategoryAttribute[],
  options: ParseSkuCsvOptions = {},
): SkuCsvParseResult {
  const requested = options.orientation ?? 'auto';
  const empty = (orientation: SkuSheetOrientation): SkuCsvParseResult => ({
    skus: [], attributes: [], rows: [], orientation,
    orientationForced: requested !== 'auto', ignoredColumns: [],
  });
  const fallback: SkuSheetOrientation = requested === 'auto' ? 'transposed' : requested;

  const wb = typeof input === 'string'
    ? XLSX.read(input, { type: 'string' })
    : XLSX.read(input, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return empty(fallback);

  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  const firstRow = grid.findIndex(r => r.some(c => String(c).trim() !== ''));
  if (firstRow === -1) return empty(fallback);

  const wideHeaderRow = findWideHeaderRow(grid);
  const orientation = requested === 'auto'
    ? detectOrientation(grid, firstRow, wideHeaderRow)
    : requested;

  const index = buildAttributeIndex(attributes);
  const parsed = orientation === 'wide'
    ? parseWide(grid, wideHeaderRow === -1 ? firstRow : wideHeaderRow, index)
    : parseTransposed(grid, firstRow, index);

  return { ...parsed, orientation, orientationForced: requested !== 'auto' };
}

type Parsed = Pick<SkuCsvParseResult, 'skus' | 'attributes' | 'rows' | 'ignoredColumns'>;

/** One row per attribute, one column per SKU. */
function parseTransposed(grid: any[][], headerIdx: number, index: AttributeIndex): Parsed {
  const header = grid[headerIdx];

  // Leading label column(s): contiguous from the left whose header is empty/label-ish.
  let firstSkuCol = 0;
  while (firstSkuCol < header.length && LABEL_HEADERS.has(norm(header[firstSkuCol]))) firstSkuCol++;
  if (firstSkuCol === 0) firstSkuCol = 1; // always treat at least column 0 as the label column
  const labelCols = Array.from({ length: firstSkuCol }, (_, i) => i);

  // SKU columns: every column at/after firstSkuCol with a non-empty header.
  const skus: SkuCsvSkuColumn[] = [];
  for (let j = firstSkuCol; j < header.length; j++) {
    const skuNumber = String(header[j] ?? '').trim();
    if (skuNumber) skus.push({ index: j, skuNumber, skuTitle: '' });
  }

  // Per-SKU accumulator, keyed by column index.
  const acc = new Map<number, SkuCsvRow>();
  for (const s of skus) acc.set(s.index, { skuNumber: s.skuNumber, skuTitle: '', values: [], flags: [] });

  const attrRows: SkuCsvAttributeRow[] = [];
  const ignoredColumns: string[] = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (isBlankRow(raw)) continue;

    const labels = labelCols.map(ci => String(raw[ci] ?? '').trim()).filter(Boolean);
    if (labels.length === 0) continue;
    const primaryLabel = labels[0];

    // A "title" row distributes SKU titles rather than attribute values.
    if (labels.some(l => TITLE_LABELS.has(norm(l)))) {
      for (const s of skus) {
        const t = String(raw[s.index] ?? '').trim();
        if (t) acc.get(s.index)!.skuTitle = t;
      }
      continue;
    }

    // A review sheet transposed as-is carries its mirror rows too. Same reasoning as the
    // wide case: they hold the other system's value, so they are reported, not imported.
    if (REFERENCE_SUFFIX.test(primaryLabel)) {
      ignoredColumns.push(primaryLabel);
      continue;
    }

    const attr = index.match(labels);
    attrRows.push({ label: primaryLabel, matched: !!attr, attributeId: attr?.id, attributeName: attr?.name });
    if (!attr) continue;

    for (const s of skus) {
      const cell = String(raw[s.index] ?? '').trim();
      if (!cell) continue;
      const row = acc.get(s.index)!;
      const value = coerceCell(attr, cell, row.flags);
      row.values.push({ attributeId: attr.id, name: attr.name, value, type: attr.dataType });
    }
  }

  // Fold titles back into the SKU column descriptors, and drop columns with no SKU number.
  for (const s of skus) s.skuTitle = acc.get(s.index)!.skuTitle;
  const rows = skus.map(s => acc.get(s.index)!).filter(r => r.skuNumber.trim());

  return { skus, attributes: attrRows, rows, ignoredColumns };
}

/** One row per SKU, one column per attribute — the review-sheet shape. */
function parseWide(grid: any[][], headerIdx: number, index: AttributeIndex): Parsed {
  const header = grid[headerIdx] ?? [];

  let skuCol = header.findIndex(c => SKU_HEADERS.has(norm(c)));
  if (skuCol === -1) skuCol = 0;

  const attrCols: { index: number; label: string; attr?: CategoryAttribute }[] = [];
  const attrRows: SkuCsvAttributeRow[] = [];
  const ignoredColumns: string[] = [];
  let titleCol = -1;

  for (let j = 0; j < header.length; j++) {
    if (j === skuCol) continue;
    const label = String(header[j] ?? '').trim();
    if (!label) continue;

    if (REFERENCE_SUFFIX.test(label)) {
      ignoredColumns.push(label);
      continue;
    }

    const attr = index.match([label]);
    // "Description"/"Title" is the SKU's own title UNLESS the category actually defines an
    // attribute by that name — a real definition outranks the convention, and only the first
    // such column is taken as the title.
    if (!attr && titleCol === -1 && TITLE_LABELS.has(norm(label))) {
      titleCol = j;
      continue;
    }

    attrCols.push({ index: j, label, attr });
    attrRows.push({ label, matched: !!attr, attributeId: attr?.id, attributeName: attr?.name });
  }

  const skus: SkuCsvSkuColumn[] = [];
  const rows: SkuCsvRow[] = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (isBlankRow(raw)) continue;

    const skuNumber = String(raw[skuCol] ?? '').trim();
    if (!skuNumber) continue;
    // Long sheets repeat their header every so often; that line is not a SKU.
    if (SKU_HEADERS.has(norm(skuNumber)) || LABEL_HEADERS.has(norm(skuNumber))) continue;

    const skuTitle = titleCol === -1 ? '' : String(raw[titleCol] ?? '').trim();
    const row: SkuCsvRow = { skuNumber, skuTitle, values: [], flags: [] };

    for (const col of attrCols) {
      if (!col.attr) continue;
      const cell = String(raw[col.index] ?? '').trim();
      if (!cell) continue;
      row.values.push({
        attributeId: col.attr.id,
        name: col.attr.name,
        value: coerceCell(col.attr, cell, row.flags),
        type: col.attr.dataType,
      });
    }

    skus.push({ index: i, skuNumber, skuTitle });
    rows.push(row);
  }

  return { skus, attributes: attrRows, rows, ignoredColumns };
}

// ---------------------------------------------------------------------------------------
// SKU ROSTER parsing — just "which SKU numbers belong to this category".
// ---------------------------------------------------------------------------------------
// Separate from parseSkuCsv on purpose. That function exists to match a sheet against a
// category's ATTRIBUTE SET, which is the wrong shape (and a needless amount of ceremony) when
// the goal is only to record that 300 numbers exist in a category so leaflet coverage can be
// reported against them. bulkUpsertCatalogSkus already accepts an empty `values` array, so a
// roster is a valid upsert payload with no service changes.
//
// Accepts one SKU per line, with an optional title after a comma, semicolon or tab:
//   10045678
//   10045679, Beverage Cooler 34L Black
// Duplicates within the paste collapse to the first occurrence (a later line's title fills
// in a blank one) rather than fighting each other during the upsert.

export interface SkuRosterParseResult {
  rows: SkuCsvRow[];
  /** Lines that held no SKU number — reported rather than silently dropped. */
  skipped: number;
  /** Repeated SKU numbers within the paste itself. */
  duplicates: number;
}

export function parseSkuRoster(text: string): SkuRosterParseResult {
  const byNumber = new Map<string, SkuCsvRow>();
  let skipped = 0;
  let duplicates = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // First delimiter splits number from title; the title may itself contain commas.
    const m = line.match(/^([^,;\t]+)(?:[,;\t]\s*(.*))?$/);
    const skuNumber = (m?.[1] ?? '').trim();
    const skuTitle = (m?.[2] ?? '').trim();
    if (!skuNumber) { skipped++; continue; }

    // A header line pasted along with the data is not a SKU.
    if (LABEL_HEADERS.has(norm(skuNumber))) { skipped++; continue; }

    const existing = byNumber.get(skuNumber);
    if (existing) {
      duplicates++;
      if (!existing.skuTitle && skuTitle) existing.skuTitle = skuTitle;
      continue;
    }
    byNumber.set(skuNumber, { skuNumber, skuTitle, values: [], flags: [] });
  }

  return { rows: [...byNumber.values()], skipped, duplicates };
}
