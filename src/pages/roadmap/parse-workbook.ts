/**
 * Roadmap Creator — workbook parsing.
 *
 * The ONLY file in this module that imports `xlsx`. Parsing happens in the BROWSER — the database
 * only ever receives the reduced JSON rows, which is how a 12MB workbook becomes a ~2MB request.
 *
 * `extractRows()` is separated from `parseWorkbook()` precisely so the interesting half can be
 * unit-tested against hand-built arrays-of-arrays, with no .xlsx committed to the repo.
 *
 * Everything here throws with a SPECIFIC message rather than returning a partial result. A
 * refused upload is recoverable; a board full of blanks that nobody notices is not.
 */
import * as XLSX from 'xlsx';
import { AXIS_FIELDS, REQUIRED_HEADERS, SHEET_NAME } from './roadmap.constants';
import type { RoadmapAttrs } from '../../types';

const HEADER_SCAN_ROWS = 40;

/** One parsed workbook row — the reduced shape that travels to the import RPC. */
export interface ParsedRoadmapRow {
  sku: string;
  description: string;
  family: string;
  systemIndex: string;
  image: string;
  price: number | null;
  supplier: string;
  shop: string;
  amazon: string;
  nov25: number | null;
  novfc25: number | null;
  fcff25: number | null;
  noq25: number | null;
  sm25: number | null;
  asp25: number | null;
  claim25: number | null;
  nov26: number | null;
  novfc26: number | null;
  fcff26: number | null;
  noq26: number | null;
  sm26: number | null;
  asp26: number | null;
  claim26: number | null;
  attrs: RoadmapAttrs;
}

export const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  // "0" is how this export writes an empty cell in text columns — a real value never is.
  return s === '' || s === '0' ? '' : s;
};

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * Cloudinary transform swap — the export carries a full-size `w_auto` URL; the board only ever
 * shows a thumbnail, so request one rather than downloading 2,500 full images.
 */
export const thumbUrl = (u: string): string =>
  u && u.startsWith('http') ? u.replace('w_auto', 'w_240') : '';

/** Locate the header row by its CONTENT, not its position. */
export function findHeaderRow(aoa: readonly unknown[][]): number {
  for (let r = 0; r < Math.min(aoa.length, HEADER_SCAN_ROWS); r++) {
    const row = aoa[r] || [];
    const hasSku = row.some(c => String(c).trim() === 'SKU');
    const hasIndex = row.some(c => String(c).trim() === 'System Index');
    if (hasSku && hasIndex) return r;
  }
  return -1;
}

/**
 * Arrays-of-arrays -> the row shape the app and the import RPC share.
 *
 * Columns are matched by header TEXT, so a column inserted upstream does not shift the parse.
 * A missing column fails LOUDLY and names every one that is absent, because "which column did
 * they rename this time" is the actual question when an export changes.
 */
export function extractRows(
  aoa: readonly unknown[][],
  { sheetName = SHEET_NAME }: { sheetName?: string } = {},
): ParsedRoadmapRow[] {
  const headerRow = findHeaderRow(aoa);
  if (headerRow < 0) {
    throw new Error(
      `Could not find the FactoryPrice_A header row (a row containing both "SKU" and ` +
        `"System Index") on sheet "${sheetName}".`,
    );
  }
  const headers = (aoa[headerRow] || []).map(h => String(h ?? '').trim());
  const idx: Record<string, number> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_HEADERS) {
    const i = headers.indexOf(name);
    if (i < 0) missing.push(name);
    else idx[name] = i;
  }
  if (missing.length) {
    throw new Error(
      `FactoryPrice_A is missing ${missing.length} expected column(s): ${missing.join(', ')}.`,
    );
  }

  const rows: ParsedRoadmapRow[] = [];
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const raw = aoa[r];
    if (!raw) continue;
    const sku = clean(raw[idx['SKU']]);
    if (!sku) continue;

    const attrs: RoadmapAttrs = {};
    for (const f of AXIS_FIELDS) {
      const v = clean(raw[idx[f]]);
      if (v) attrs[f] = v;
    }
    const shop = clean(raw[idx['Shop Link']]);
    const amazon = clean(raw[idx['Amazon DE Link']]);

    rows.push({
      sku,
      description: clean(raw[idx['Description']]),
      family: clean(raw[idx['Family']]),
      systemIndex: clean(raw[idx['System Index']]),
      image: thumbUrl(clean(raw[idx['Product Image']])),
      price: num(raw[idx['Est. Factory Price']]),
      supplier: clean(raw[idx['Supplier']]),
      shop: shop.startsWith('http') ? shop : '',
      amazon: amazon.startsWith('http') ? amazon : '',
      // 2025 commercial
      nov25: num(raw[idx['NOV_2025']]),
      novfc25: num(raw[idx['NOV FC 2025']]),
      fcff25: num(raw[idx['FC FF NOV_2025']]),
      noq25: num(raw[idx['NOQ_2025']]),
      sm25: num(raw[idx['SM%_2025']]),
      asp25: num(raw[idx['ASP_2025']]),
      claim25: num(raw[idx['2025 Claim Rate']]),
      // 2026 commercial
      nov26: num(raw[idx['NOV_2026']]),
      novfc26: num(raw[idx['NOV FC 2026']]),
      fcff26: num(raw[idx['FC FF NOV_2026']]),
      noq26: num(raw[idx['NOQ_2026']]),
      sm26: num(raw[idx['SM%_2026']]),
      asp26: num(raw[idx['ASP_2026']]),
      claim26: num(raw[idx['2026 Claim Rate']]),
      attrs,
    });
  }

  if (!rows.length) throw new Error('FactoryPrice_A was found but contained no data rows.');
  return rows;
}

/**
 * ArrayBuffer -> parsed rows. The only I/O in this module.
 *
 * The real export is ~12MB across 22 sheets and only one of them matters. SheetJS's `sheets`
 * option still lists every sheet name but only materialises the requested one, which takes the
 * parse from ~9s to well under a second — worth doing, because this runs on the browser's main
 * thread and would otherwise freeze the tab. If the expected sheet is not there we re-read the
 * whole workbook and fall back to the first sheet.
 */
export function parseWorkbook(buffer: ArrayBuffer): ParsedRoadmapRow[] {
  const bytes = new Uint8Array(buffer);
  let wb = XLSX.read(bytes, { type: 'array', sheets: SHEET_NAME });
  let sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === SHEET_NAME.toLowerCase());

  if (!sheetName || !wb.Sheets[sheetName]) {
    wb = XLSX.read(bytes, { type: 'array' });
    sheetName =
      wb.SheetNames.find(n => n.trim().toLowerCase() === SHEET_NAME.toLowerCase()) ||
      wb.SheetNames[0];
  }

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
  });
  return extractRows(aoa, { sheetName });
}

export interface RowSummary {
  rowCount: number;
  categoryCount: number;
  familyCount: number;
}

/**
 * A quick shape summary for the upload preview, so somebody can sanity-check a file before
 * committing it to the shared database. This is the "preview counts" half of the deliberate
 * two-step parse -> preview -> commit: the person committing sees what they are about to change
 * for everyone.
 */
export function summarizeRows(rows: readonly ParsedRoadmapRow[]): RowSummary {
  const categories = new Set<string>();
  const families = new Set<string>();
  for (const r of rows) {
    if (r.systemIndex) categories.add(r.systemIndex);
    if (r.family) families.add(r.family);
  }
  return { rowCount: rows.length, categoryCount: categories.size, familyCount: families.size };
}
