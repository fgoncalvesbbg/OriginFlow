/**
 * SKU catalog service — manages SKUs across the whole app, including project-less "catalog"
 * SKUs (legacy items with no project). Backed by the same `project_skus` table (see
 * db_migrations/93_standalone_sku_catalog.sql): a NULL project_id means a catalog SKU, and
 * category_id lives directly on the row so a project-less SKU still resolves its attribute set.
 */
import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { CatalogSku, SkuAttributeValue } from '../../types';
import { mapProjectSku } from './project-sku.service';
import { logSkuChanges, logSkuCreated, type ChangeActor } from './sku-log.service';

/** Server-side join pulling the owning project's name and category — see data/PORTING.md. */
const CATALOG_COLUMNS = '*, projects(id, name, category_id)';

const mapCatalog = (r: any): CatalogSku => ({
  ...mapProjectSku(r),
  // For project SKUs the category comes from the project when the row itself has none.
  categoryId: r.category_id ?? r.projects?.category_id ?? null,
  projectName: r.projects?.name ?? null,
});

/**
 * Every SKU in the system (catalog + project), enriched with project name and effective
 * category. The catalog page filters these client-side by category.
 */
export const getCatalogSkus = async (): Promise<CatalogSku[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_skus', {
      columns: CATALOG_COLUMNS,
      order: { column: 'sku_number', ascending: true },
    }),
    'getCatalogSkus',
  );
  return rows.map(mapCatalog);
};

/** Create a project-less catalog SKU under a category (no per-project cap applies). */
export const createCatalogSku = async (
  categoryId: string,
  skuNumber: string,
  skuTitle: string,
  attributeValues: SkuAttributeValue[] = [],
): Promise<CatalogSku> => {
  if (!isLive) throw new Error('Database not configured.');
  const created = await db.insert<Row>(
    'project_skus',
    {
      project_id: null,
      category_id: categoryId,
      sku_number: skuNumber,
      sku_title: skuTitle,
      attribute_values: attributeValues,
      sort_order: 0,
    },
    { columns: CATALOG_COLUMNS },
  );
  return mapCatalog(created);
};

export interface ParsedSkuRow {
  skuNumber: string;
  skuTitle: string;
  values: SkuAttributeValue[];
  flags: string[];
}

export interface BulkUpsertSkuResult {
  created: number;
  updated: number;
  skipped: number;
  /** Existing SKUs left untouched because they are locked (final). */
  lockedSkipped: number;
}

/**
 * Bulk-create/update catalog SKUs from a parsed sheet.
 * Idempotent: matches existing catalog SKUs by sku_number (globally unique among project-less
 * rows). Existing values for attributes NOT present in the file are preserved (merge, not
 * replace). SKUs marked final are protected — they are skipped (lockedSkipped), never
 * overwritten. When an actor is supplied, each create/update is written to the change log.
 */
export const bulkUpsertCatalogSkus = async (
  categoryId: string,
  rows: ParsedSkuRow[],
  actor?: ChangeActor,
): Promise<BulkUpsertSkuResult> => {
  if (!isLive) throw new Error('Database not configured.');
  const result: BulkUpsertSkuResult = { created: 0, updated: 0, skipped: 0, lockedSkipped: 0 };

  // Existing catalog SKUs, keyed by sku_number. A null project_id is what makes a row "catalog".
  const existingRows = await db.select<Row>('project_skus', { where: { project_id: null } });
  const byNumber = new Map<string, ReturnType<typeof mapProjectSku>>();
  for (const r of existingRows) byNumber.set((r.sku_number ?? '').trim(), mapProjectSku(r));

  for (const row of rows) {
    const number = row.skuNumber.trim();
    if (!number) { result.skipped++; continue; }

    const existing = byNumber.get(number);
    if (existing) {
      if (existing.isFinal) { result.lockedSkipped++; continue; } // locked — never overwrite
      // Overlay the file's values onto the existing set (keyed by attributeId).
      const merged = new Map<string, SkuAttributeValue>();
      for (const v of existing.attributeValues) merged.set(v.attributeId, v);
      for (const v of row.values) merged.set(v.attributeId, v);
      await db.updateWhere(
        'project_skus',
        {
          sku_title: row.skuTitle || existing.skuTitle,
          category_id: categoryId,
          attribute_values: Array.from(merged.values()),
          pending_export: true,
          updated_at: new Date().toISOString(),
        },
        { where: { id: existing.id } },
      );
      if (actor) await logSkuChanges(existing.id, number, row.values.map(v => ({ field: v.name, oldValue: null, newValue: v.value })), actor, 'bulk upload');
      result.updated++;
    } else {
      const created = await createCatalogSku(categoryId, number, row.skuTitle, row.values);
      if (actor) await logSkuCreated(created.id, number, actor, 'bulk upload');
      result.created++;
    }
  }

  return result;
};
