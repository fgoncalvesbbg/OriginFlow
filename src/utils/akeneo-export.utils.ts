/**
 * Builds Akeneo-importable product rows from SKUs: one row per SKU, one column per attribute
 * keyed by its Akeneo code (falling back to a slug of the name). Booleans are emitted as 1/0
 * (Akeneo yes/no format). Pure and testable; the page turns the result into a CSV via SheetJS.
 */
import type { CategoryAttribute, ProjectSku } from '../types';

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Column code used for an attribute in the Akeneo export (Akeneo code, else a name slug). */
export const akeneoColumnCode = (attr: CategoryAttribute): string => attr.akeneoId?.trim() || slug(attr.name);

const formatValue = (attr: CategoryAttribute, value: string): string => {
  if (value == null || value === '') return '';
  if (attr.dataType === 'boolean') return value === 'true' ? '1' : value === 'false' ? '0' : value;
  return value;
};

export type AkeneoExportRow = Record<string, string>;

/**
 * @returns headers in column order and one row object per SKU (keyed by those headers).
 * Duplicate attribute codes are de-duplicated (first wins) so the column set is stable.
 */
export function buildAkeneoRows(
  skus: ProjectSku[],
  attrs: CategoryAttribute[],
): { headers: string[]; rows: AkeneoExportRow[] } {
  const headers = ['sku', 'sku_title'];
  const seen = new Set(headers);
  const cols: { code: string; attr: CategoryAttribute }[] = [];
  for (const attr of attrs) {
    const code = akeneoColumnCode(attr);
    if (seen.has(code)) continue; // avoid duplicate columns
    seen.add(code);
    headers.push(code);
    cols.push({ code, attr });
  }

  const rows = skus.map(sku => {
    const row: AkeneoExportRow = { sku: sku.skuNumber, sku_title: sku.skuTitle };
    for (const { code, attr } of cols) {
      const raw = sku.attributeValues.find(v => v.attributeId === attr.id)?.value ?? '';
      row[code] = formatValue(attr, raw);
    }
    return row;
  });

  return { headers, rows };
}
