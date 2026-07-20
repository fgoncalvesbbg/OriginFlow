/**
 * Parser for a TRANSPOSED "SKU values" sheet: one row per ATTRIBUTE, one column per SKU.
 *   - The header row holds the SKU numbers (after any leading label column(s)).
 *   - Each body row starts with an attribute identifier (Akeneo code or name) and then its
 *     value for each SKU column. An optional "title" row supplies SKU titles.
 * Columns are matched to a category's attributes by Akeneo code first, then by name. Pure and
 * unit-testable; the DB upsert lives in sku-catalog.service.ts (bulkUpsertCatalogSkus).
 */
import * as XLSX from 'xlsx';
import type { CategoryAttribute, SkuAttributeValue } from '../types';

export interface SkuCsvSkuColumn {
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
}

const norm = (s: any) => String(s ?? '').trim().toLowerCase();

// Header tokens for the leading label column(s) (not SKU columns), and for the optional
// SKU-title row (matched on its first-column label).
const LABEL_HEADERS = new Set(['', 'attribute', 'attributes', 'code', 'akeneo', 'akeneo code', 'name', 'field', 'sku', 'attribute name']);
const TITLE_LABELS = new Set(['title', 'sku title', 'sku_title', 'name', 'product name', 'product_name', 'description']);

function normalizeBoolean(raw: string): string | null {
  const v = norm(raw);
  if (['yes', 'y', 'true', '1', 'x'].includes(v)) return 'true';
  if (['no', 'n', 'false', '0'].includes(v)) return 'false';
  return null;
}

/**
 * Parse a transposed SKU sheet against a category's attribute set.
 * @param input      CSV/XLSX buffer (browser) or string (tests).
 * @param attributes The attributes of the target category (from getAttributesForCategory).
 */
export function parseSkuCsv(
  input: ArrayBuffer | Uint8Array | string,
  attributes: CategoryAttribute[],
): SkuCsvParseResult {
  const wb = typeof input === 'string'
    ? XLSX.read(input, { type: 'string' })
    : XLSX.read(input, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { skus: [], attributes: [], rows: [] };

  const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  const headerIdx = grid.findIndex(r => r.some(c => String(c).trim() !== ''));
  if (headerIdx === -1) return { skus: [], attributes: [], rows: [] };

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

  // Attribute lookups.
  const byCode = new Map<string, CategoryAttribute>();
  const byName = new Map<string, CategoryAttribute>();
  for (const a of attributes) {
    if (a.akeneoId) byCode.set(norm(a.akeneoId), a);
    byName.set(norm(a.name), a);
  }

  // Per-SKU accumulator, keyed by column index.
  const acc = new Map<number, SkuCsvRow>();
  for (const s of skus) acc.set(s.index, { skuNumber: s.skuNumber, skuTitle: '', values: [], flags: [] });

  const attrRows: SkuCsvAttributeRow[] = [];

  for (let i = headerIdx + 1; i < grid.length; i++) {
    const raw = grid[i];
    if (!raw || raw.every(c => String(c).trim() === '')) continue;

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

    // Match the attribute by any of the leading label cells (code first, then name).
    let attr: CategoryAttribute | undefined;
    for (const l of labels) { attr = byCode.get(norm(l)) ?? byName.get(norm(l)); if (attr) break; }
    attrRows.push({ label: primaryLabel, matched: !!attr, attributeId: attr?.id, attributeName: attr?.name });
    if (!attr) continue;

    for (const s of skus) {
      const cell = String(raw[s.index] ?? '').trim();
      if (!cell) continue;
      const row = acc.get(s.index)!;
      let value = cell;

      if (attr.dataType === 'boolean') {
        const b = normalizeBoolean(cell);
        if (b === null) row.flags.push(`${attr.name}: "${cell}" is not a yes/no value`);
        else value = b;
      } else if (attr.dataType === 'enum') {
        const opts = attr.validationRules?.enumOptions ?? [];
        if (opts.length > 0 && !opts.some(o => norm(o) === norm(cell))) {
          row.flags.push(`${attr.name}: "${cell}" is not one of the allowed options`);
        }
      } else if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
        if (isNaN(Number(cell.replace(',', '.')))) row.flags.push(`${attr.name}: "${cell}" is not a number`);
      }

      row.values.push({ attributeId: attr.id, name: attr.name, value, type: attr.dataType });
    }
  }

  // Fold titles back into the SKU column descriptors, and drop columns with no SKU number.
  for (const s of skus) s.skuTitle = acc.get(s.index)!.skuTitle;
  const rows = skus.map(s => acc.get(s.index)!).filter(r => r.skuNumber.trim());

  return { skus, attributes: attrRows, rows };
}
