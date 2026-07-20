/**
 * Parser for the "category attributes" CSV format (e.g. docs/beverage coolers.csv).
 *
 * Each spreadsheet defines every attribute of one product category: its name, the
 * section/group it belongs to, the Akeneo code, a suggested data type, and select-options.
 * This module turns that raw file into normalized, previewable rows. It is intentionally
 * pure (no DB access) so it can be unit-tested and driven from a preview UI. The actual
 * upsert/dedup happens in `importCategoryAttributes` (compliance-requirement.service.ts).
 *
 * Expected columns (header row is auto-detected — the file has a blank lead-in):
 *   Attribute | Type | Akeneo Code | Suggested Data Type | Options / Range | Notes
 */
import * as XLSX from 'xlsx';
import type { AttributeDataType } from '../types';

/** A single parsed CSV row, mapped to app concepts and flagged for review. */
export interface ParsedAttributeRow {
  name: string;
  akeneoId?: string;
  /** One of ATTRIBUTE_GROUPS. */
  group: string;
  dataType: AttributeDataType;
  /** Select options (enum only). */
  enumOptions?: string[];
  /** Unit pulled from the label, numeric attributes only (e.g. "L", "°C", "cm"). */
  unit?: string;
  /** Non-fatal issues the user should eyeball in the preview. */
  flags: string[];
  /** The raw "Type" cell, kept for the preview/debugging. */
  rawGroup: string;
  /** The raw "Suggested Data Type" cell. */
  rawDataType: string;
}

/**
 * CSV "Type" column → canonical ATTRIBUTE_GROUPS value. Keys are normalized (leading
 * numbering stripped, lower-cased) — see `normalize`. Anything unmatched falls back to
 * 'Category Specific' with a flag.
 */
const GROUP_MAP: Record<string, string> = {
  'category & segmentation': 'Segmentation',
  'listing & data': 'Variation Axes',
  'category specific attributes': 'Category Specific',
  'category specific': 'Category Specific',
  'standard specs': 'Standard Electric Specs',
  'standard electric specs': 'Standard Electric Specs',
  'product dimensions': 'Product Dimensions',
  'battery information': 'Battery Information',
  'packaging': 'Packaging',
};

/** Placeholder Akeneo codes seen in source sheets that should be confirmed manually. */
const PLACEHOLDER_CODE = /^new\d*$/i;

/** Options cells that hold prose/notes rather than a real delimited option list. */
const PROSE_OPTION = /\b(no data|free text|observed range|recommend|inferred|na)\b/i;

/** Strip leading section numbering like "1 . " or "2." and surrounding whitespace, lower-case. */
function normalize(s: string): string {
  return String(s ?? '')
    .replace(/^\s*\d+\s*\.?\s*/, '')
    .trim()
    .toLowerCase();
}

function mapGroup(rawGroup: string): { group: string; unmapped: boolean } {
  const key = normalize(rawGroup);
  const mapped = GROUP_MAP[key];
  return mapped ? { group: mapped, unmapped: false } : { group: 'Category Specific', unmapped: true };
}

function mapDataType(rawType: string): { dataType: AttributeDataType; unmapped: boolean } {
  const t = normalize(rawType);
  if (!t) return { dataType: 'text', unmapped: true };
  if (t.includes('boolean')) return { dataType: 'boolean', unmapped: false };
  if (t.includes('number')) {
    return { dataType: t.includes('integer') ? 'integer' : 'decimal', unmapped: false };
  }
  // "simple select", "simple select (color swatch)", "reference entity (single link)"
  if (t.includes('select') || t.includes('reference entity')) return { dataType: 'enum', unmapped: false };
  if (t.includes('text')) return { dataType: 'text', unmapped: false };
  return { dataType: 'text', unmapped: true };
}

/** Split an options cell on ';' or newlines, trim, and drop blanks. */
function splitOptions(raw: string): string[] {
  return String(raw ?? '')
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Extract a trailing "[unit]" from a numeric attribute's label and return the cleaned name.
 * Only used for integer/decimal — for other types brackets are hints (e.g. "[Y/N]"), not units.
 */
function extractUnit(name: string): { name: string; unit?: string } {
  const m = name.match(/\[([^\]]+)\]\s*$/);
  if (!m) return { name: name.trim() };
  return { name: name.slice(0, m.index).trim(), unit: m[1].trim() };
}

function isBlankRow(row: any[]): boolean {
  return !row || row.every(c => c === undefined || c === null || String(c).trim() === '');
}

/**
 * Parse a category-attributes CSV/XLSX buffer into normalized, flagged rows.
 * Accepts an ArrayBuffer (browser FileReader.readAsArrayBuffer) or a string (tests).
 */
export function parseAttributeCsv(input: ArrayBuffer | Uint8Array | string): ParsedAttributeRow[] {
  const wb =
    typeof input === 'string'
      ? XLSX.read(input, { type: 'string' })
      : XLSX.read(input, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });

  // Locate the header row: it contains both "Attribute" and "Akeneo" somewhere.
  const headerIdx = rows.findIndex(r =>
    r.some(c => normalize(c) === 'attribute') && r.some(c => normalize(c).includes('akeneo')),
  );
  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(c => normalize(c));
  const col = (needle: string) => header.findIndex(h => h.includes(needle));
  const idxName = col('attribute');
  const idxType = col('type');
  const idxCode = col('akeneo');
  const idxDataType = header.findIndex(h => h.includes('data type'));
  const idxOptions = header.findIndex(h => h.includes('option'));

  const seenCodes = new Set<string>();
  const result: ParsedAttributeRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row)) continue;

    const rawName = String(row[idxName] ?? '').trim();
    if (!rawName) continue; // skip separator/partial rows without an attribute name

    const rawGroup = String(row[idxType] ?? '').trim();
    const rawDataType = String(idxDataType >= 0 ? row[idxDataType] ?? '' : '').trim();
    const rawCode = String(idxCode >= 0 ? row[idxCode] ?? '' : '').trim();
    const rawOptions = String(idxOptions >= 0 ? row[idxOptions] ?? '' : '').trim();

    const flags: string[] = [];
    const { group, unmapped: groupUnmapped } = mapGroup(rawGroup);
    if (groupUnmapped) flags.push(`Unrecognized group "${rawGroup}" → Category Specific`);

    const { dataType, unmapped: typeUnmapped } = mapDataType(rawDataType);
    if (typeUnmapped) flags.push(`Unrecognized data type "${rawDataType}" → ${dataType}`);

    let name = rawName;
    let unit: string | undefined;
    let enumOptions: string[] | undefined;

    if (dataType === 'integer' || dataType === 'decimal') {
      const ex = extractUnit(rawName);
      name = ex.name;
      unit = ex.unit;
    } else if (dataType === 'enum') {
      if (rawOptions && !PROSE_OPTION.test(rawOptions)) {
        enumOptions = splitOptions(rawOptions);
      }
      if (!enumOptions || enumOptions.length === 0) {
        flags.push('Select attribute has no usable options — add them after import');
      }
    }

    const akeneoId = rawCode || undefined;
    if (akeneoId) {
      if (PLACEHOLDER_CODE.test(akeneoId)) flags.push(`Placeholder Akeneo code "${akeneoId}" — confirm real code`);
      const codeKey = akeneoId.toLowerCase();
      if (seenCodes.has(codeKey)) flags.push(`Duplicate Akeneo code "${akeneoId}" in this file`);
      seenCodes.add(codeKey);
    }

    result.push({
      name,
      akeneoId,
      group,
      dataType,
      enumOptions,
      unit,
      flags,
      rawGroup,
      rawDataType,
    });
  }

  return result;
}
