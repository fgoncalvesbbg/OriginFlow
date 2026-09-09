/**
 * SKU catalog service — manages SKUs across the whole app, including project-less "catalog"
 * SKUs (legacy items with no project). Backed by the same `project_skus` table (see
 * db_migrations/93_standalone_sku_catalog.sql): a NULL project_id means a catalog SKU, and
 * category_id lives directly on the row so a project-less SKU still resolves its attribute set.
 */
import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { CatalogSku, SkuAttributeValue, SkuValueSource } from '../../types';
import { mapProjectSku } from './project-sku.service';
import { logSkuChanges, logSkuCreated, type ChangeActor } from './sku-log.service';
import { syncValueRowsFromJsonb } from './sku-attribute-value.service';

/** Server-side join pulling the owning project's name and category — see data/PORTING.md. */
const CATALOG_COLUMNS = '*, projects(id, name, category_id)';

const mapCatalog = (r: any): CatalogSku => ({
  ...mapProjectSku(r),
  // For project SKUs the category comes from the project when the row itself has none.
  categoryId: r.category_id ?? r.projects?.category_id ?? null,
  projectName: r.projects?.name ?? null,
});

/** Create a project-less catalog SKU under a category (no per-project cap applies). */
export const createCatalogSku = async (
  categoryId: string,
  skuNumber: string,
  skuTitle: string,
  attributeValues: SkuAttributeValue[] = [],
  /** Provenance for any values created alongside the SKU. A bulk upload is not 'manual'. */
  source: SkuValueSource = 'manual',
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

  // These two functions write attribute_values DIRECTLY rather than through
  // updateProjectSku, so they are the two paths that would otherwise leave the
  // authoritative row store (sku_attribute_values, migration 155) behind the mirror.
  // Logged rather than thrown: the SKU itself is created, and failing the create because a
  // secondary sync failed would be the worse outcome.
  if (attributeValues.length > 0) {
    try {
      await syncValueRowsFromJsonb({ projectSkuId: created.id, values: attributeValues, source });
    } catch (e) {
      console.error('[createCatalogSku] value-row sync failed; the SKU was still created', e);
    }
  }

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
      try {
        await syncValueRowsFromJsonb({
          projectSkuId: existing.id,
          values: Array.from(merged.values()),
          source: 'sheet-import',
        });
      } catch (e) {
        console.error('[bulkUpsertCatalogSkus] value-row sync failed for ' + number, e);
      }
      if (actor) await logSkuChanges(existing.id, number, row.values.map(v => ({ field: v.name, oldValue: null, newValue: v.value })), actor, 'bulk upload');
      result.updated++;
    } else {
      const created = await createCatalogSku(categoryId, number, row.skuTitle, row.values, 'sheet-import');
      if (actor) await logSkuCreated(created.id, number, actor, 'bulk upload');
      result.created++;
    }
  }

  return result;
};
