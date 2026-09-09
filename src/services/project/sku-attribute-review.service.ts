/**
 * Attribute review service — powers the Attribute Viewer. Aggregates SKUs across every project in
 * an L3 category (for side-by-side comparison) and manages per-cell review flags/comments.
 * Editing an attribute value reuses updateProjectSku (the SKU row is the source of truth).
 */
import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectSku, SkuAttributeFlag } from '../../types';

/** A SKU enriched with its owning project's name, for column headers in the viewer. */
export interface CategorySku extends ProjectSku {
  projectName: string;
}

const mapSku = (r: any): CategorySku => ({
  id: r.id,
  projectId: r.project_id,
  categoryId: r.category_id ?? null,
  skuNumber: r.sku_number ?? '',
  skuTitle: r.sku_title ?? '',
  attributeValues: r.attribute_values ?? [],
  sortOrder: r.sort_order ?? 0,
  isFinal: r.is_final ?? false,
  pendingExport: r.pending_export ?? false,
  lastExportedAt: r.last_exported_at ?? null,
  finalizedAt: r.finalized_at ?? null,
  finalizedBy: r.finalized_by ?? null,
  reopenReason: r.reopen_reason ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  projectName: r.projects?.name ?? '',
});

/**
 * Merge the two reads below into one column list: deduplicated by SKU **record id**, ordered by
 * SKU number.
 *
 * Deduplicating by id and not by `skuNumber` is the point. A number is not unique in OriginFlow —
 * live, 10046631 / 10046632 / 10047753 and others each name two different records — and collapsing
 * them would silently merge two products into one column, hiding whichever one lost. Both records
 * survive here and the grid badges them as duplicates.
 *
 * Exported for its own tests: the merge is where a mistake would be invisible in the UI (a column
 * quietly missing looks exactly like a category that genuinely has fewer SKUs).
 */
export const mergeCategorySkus = (
  ...batches: readonly (readonly CategorySku[])[]
): CategorySku[] => {
  const byId = new Map<string, CategorySku>();
  for (const batch of batches) {
    for (const sku of batch) {
      // First write wins, and the SKU-stamped read is passed first, so a SKU matched both ways
      // keeps the row that carries its own category rather than its project's.
      if (!byId.has(sku.id)) byId.set(sku.id, sku);
    }
  }
  return [...byId.values()].sort(
    (a, b) => a.skuNumber.localeCompare(b.skuNumber, undefined, { numeric: true }),
  );
};

/**
 * Every SKU in the given L3 category, however it got there.
 *
 * TWO reads, unioned, because a SKU can belong to a category by either of two routes and the port
 * has no way to express an OR across two tables' columns:
 *
 *   (a) the SKU carries the category itself — `project_skus.category_id`. This is every
 *       project-less catalog SKU, and any project SKU stamped with a category of its own.
 *   (b) the SKU's PROJECT carries the category — `projects.category_id`.
 *
 * This used to be (b) alone, which hid **111 of the 154 live SKUs**: every catalog SKU has
 * `project_id IS NULL`, so the inner join dropped all of them, and so did any project SKU whose own
 * category differs from its project's. A category would report 43 SKUs and look complete.
 *
 * That is the one rule this module exists to serve — *a hidden gap is a gap that cannot be found*.
 * A SKU nobody can see is a SKU nobody will ever fill in.
 */
export const getSkusByCategory = async (categoryId: string): Promise<CategorySku[]> => {
  if (!isLive) return [];

  const [own, viaProject] = await Promise.all([
    // Left join, NOT `!inner`: a catalog SKU has no project and must still come back. The
    // embedded select and the filter on a joined column are both PostgREST-specific — see
    // data/PORTING.md for what another adapter owes them.
    orEmpty(
      db.select<Row>('project_skus', {
        columns: '*, projects(id, name, category_id)',
        // project_skus.category_id is TEXT where categories_l3.id is uuid, so this compares as
        // text on purpose. Worth knowing before anyone "fixes" the column type.
        where: { category_id: categoryId },
      }),
      'getSkusByCategory.own',
    ),
    orEmpty(
      db.select<Row>('project_skus', {
        columns: '*, projects!inner(id, name, category_id)',
        where: { 'projects.category_id': categoryId },
      }),
      'getSkusByCategory.viaProject',
    ),
  ]);

  return mergeCategorySkus(own.map(mapSku), viaProject.map(mapSku));
};

/** What the category browser needs to know about one category, without opening it. */
export interface CategorySkuSummary {
  count: number;
  /** Up to three item numbers, so the section can carry a picture. */
  samples: string[];
}

/**
 * SKU counts and a few sample item numbers per L3 category, by the same union rule as
 * `getSkusByCategory`.
 *
 * ONE read of every SKU's identifying columns rather than a count per category: the catalogue
 * is ~200 categories and the whole table is ~150 rows, so a query per category would be two
 * hundred round trips to compute what one returns. Only the columns needed are selected, so the
 * payload stays small as the table grows.
 *
 * Feeds the category browser, which is the landing page — it has to be cheap, because nothing
 * has been picked yet and the operator has not asked for anything expensive.
 *
 * Three samples rather than one because the picture stands for the whole category: which item
 * provides it does not matter, only that something loads, and not every item has an image.
 */
export const getCategorySkuIndex = async (): Promise<Map<string, CategorySkuSummary>> => {
  const index = new Map<string, CategorySkuSummary>();
  if (!isLive) return index;
  const rows = await orEmpty(
    db.select<Row>('project_skus', {
      columns: 'id, sku_number, category_id, projects(category_id)',
      order: { column: 'sku_number', ascending: true },
    }),
    'getCategorySkuIndex',
  );
  for (const r of rows) {
    // A SKU counts once, under its own category if it has one, otherwise its project's — the
    // same precedence getSkusByCategory's merge applies, so the browser's number and the
    // grid's number cannot disagree.
    const id = (r.category_id as string | null) ?? (r.projects?.category_id as string | null);
    if (!id) continue;
    const entry = index.get(id) ?? { count: 0, samples: [] };
    entry.count += 1;
    const number = (r.sku_number as string | null) ?? '';
    if (entry.samples.length < 3 && number.trim() !== '') entry.samples.push(number);
    index.set(id, entry);
  }
  return index;
};

const mapFlag = (r: any): SkuAttributeFlag => ({
  id: r.id,
  projectSkuId: r.project_sku_id,
  attributeId: r.attribute_id,
  status: r.status ?? 'open',
  comment: r.comment ?? '',
  flaggedBy: r.flagged_by ?? null,
  flaggedByName: r.flagged_by_name ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at ?? null,
});

/** All review flags for the given SKU ids (the SKUs currently shown in the viewer). */
export const getFlagsForSkus = async (skuIds: string[]): Promise<SkuAttributeFlag[]> => {
  if (!isLive || skuIds.length === 0) return [];
  const rows = await orEmpty(
    db.select<Row>('sku_attribute_flags', { where: { project_sku_id: skuIds } }),
    'getFlagsForSkus',
  );
  return rows.map(mapFlag);
};

/**
 * Flag a cell (or update an existing flag's comment). Re-opens a previously resolved flag.
 * One flag per (SKU, attribute) cell, enforced by the table's unique constraint.
 */
export const upsertSkuAttributeFlag = async (
  projectSkuId: string,
  attributeId: string,
  comment: string,
  flaggedBy: string | null,
  flaggedByName: string,
): Promise<SkuAttributeFlag> => {
  if (!isLive) throw new Error('Database not configured.');
  const saved = await db.upsertReturning<Row>(
    'sku_attribute_flags',
    {
      project_sku_id: projectSkuId,
      attribute_id: attributeId,
      comment,
      status: 'open',
      flagged_by: flaggedBy,
      flagged_by_name: flaggedByName,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_sku_id,attribute_id' },
  );
  return mapFlag(saved);
};

/** Mark a flag resolved (or re-open it). Stamps resolved_at when resolving. */
export const setSkuAttributeFlagResolved = async (
  id: string,
  resolved: boolean,
): Promise<SkuAttributeFlag> => {
  if (!isLive) throw new Error('Database not configured.');
  const updated = await db.update<Row>(
    'sku_attribute_flags',
    {
      status: resolved ? 'resolved' : 'open',
      resolved_at: resolved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { where: { id } },
  );
  return mapFlag(updated);
};

/** Remove a flag entirely. */
export const deleteSkuAttributeFlag = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('sku_attribute_flags', { where: { id } });
};
