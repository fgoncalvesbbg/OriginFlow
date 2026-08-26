/**
 * Leaflet coverage — "which safety leaflet does SKU 12345 get, and which SKUs still have
 * none?". Backed by db_migrations/132_create_im_leaflet_issues.sql; read that header for the
 * data-model tradeoffs, they are not repeated here.
 *
 * The two shapes this exists to serve:
 *
 *   GENERIC category ('category' mode) — one leaflet, no SKU data inside, answers for every
 *   SKU. Issued ONCE as a single row with sku_number NULL, so a SKU imported next year is
 *   covered with no further action. Nothing per-SKU is ever written.
 *
 *   SKU-SPECIFIC category ('sku' mode) — the PDF contains SKU data, so it covers one SKU or a
 *   group of them. One row per SKU number, all sharing the render_id of the PDF whose content
 *   was built from exactly that group. The render IS the group's identity.
 *
 * A SKU-specific issue always wins over the category-wide one (migration 116's
 * explicit-beats-derived), so a mostly-generic category can still carry one odd exception.
 *
 * WHY THESE WRITES READ FIRST INSTEAD OF UPSERTING: the uniqueness that matters here is
 * enforced by two PARTIAL unique indexes (`... WHERE sku_number IS NULL` / `IS NOT NULL`), and
 * PostgREST's on_conflict takes column names only — it cannot carry an index predicate, so
 * ON CONFLICT can never infer a partial index. `bulkUpsertCatalogSkus` reads-then-branches for
 * the same reason. im_leaflet_policies has a TOTAL unique index and so does upsert normally.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';

/** Only leaflets have the generic-vs-SKU-specific split; the tables carry both types anyway. */
const TEMPLATE_TYPE: IMTemplateType = 'warning_leaflet';

/** How a category's leaflet is scoped. Absent policy row reads as 'category' — see migration 132. */
export type LeafletMode = 'category' | 'sku';

/**
 * Why a SKU does or does not have a leaflet. Derived from the view's columns, never stored,
 * so it cannot drift from the underlying rows.
 */
export type LeafletCoverageStatus =
  /** Resolved: `renderUrl` is the PDF this SKU gets. */
  | 'issued'
  /** The SKU has no category, so no leaflet can be resolved at all. */
  | 'unclassified'
  /** The category has no warning-leaflet template — nothing has been authored yet. */
  | 'no_template'
  /** Generic category, nothing issued. ONE action covers every SKU in it. */
  | 'category_not_issued'
  /** Per-SKU category, this SKU unassigned. One action per SKU or per group. */
  | 'sku_not_assigned';

/** One row of `im_sku_leaflet_coverage` — one distinct SKU number and its resolved leaflet. */
export interface LeafletCoverageRow {
  skuId: string;
  skuNumber: string;
  skuTitle: string;
  /** NULL for a catalog SKU. The view prefers the catalog row when a number exists twice. */
  projectId: string | null;
  isFinal: boolean;
  categoryId: string | null;
  categoryName: string | null;
  mode: LeafletMode;
  templateId: string | null;
  templateName: string | null;
  issueId: string | null;
  /** True when a per-SKU issue resolved this row, false when the category-wide one did. */
  isSkuSpecific: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  issueNote: string | null;
  renderId: string | null;
  renderProjectId: string | null;
  imVersion: number | null;
  languages: string[];
  pageSize: string | null;
  market: string | null;
  renderUrl: string | null;
  pages: number | null;
  renderedAt: string | null;
  renderComment: string | null;
  status: LeafletCoverageStatus;
}

/** Derived, in one place, so the UI never re-implements the precedence. */
const deriveStatus = (r: Row): LeafletCoverageStatus => {
  if (r.render_id) return 'issued';
  if (!r.category_id) return 'unclassified';
  if (!r.template_id) return 'no_template';
  return r.mode === 'sku' ? 'sku_not_assigned' : 'category_not_issued';
};

const mapCoverage = (r: Row): LeafletCoverageRow => ({
  skuId: r.sku_id,
  skuNumber: r.sku_number ?? '',
  skuTitle: r.sku_title ?? '',
  projectId: r.project_id ?? null,
  isFinal: !!r.is_final,
  categoryId: r.category_id ?? null,
  categoryName: r.category_name ?? null,
  mode: (r.mode as LeafletMode) ?? 'category',
  templateId: r.template_id ?? null,
  templateName: r.template_name ?? null,
  issueId: r.issue_id ?? null,
  isSkuSpecific: !!r.is_sku_specific,
  issuedAt: r.issued_at ?? null,
  issuedBy: r.issued_by ?? null,
  issueNote: r.issue_note ?? null,
  renderId: r.render_id ?? null,
  renderProjectId: r.render_project_id ?? null,
  imVersion: r.im_version ?? null,
  languages: r.languages ?? [],
  pageSize: r.page_size ?? null,
  market: r.market ?? null,
  renderUrl: r.url ?? null,
  pages: r.pages ?? null,
  renderedAt: r.rendered_at ?? null,
  renderComment: r.render_comment ?? null,
  status: deriveStatus(r),
});

/**
 * Every SKU in the system with the leaflet it resolves to. One row per distinct SKU number —
 * the view collapses the catalog/project duplicate, preferring the catalog row as the roster
 * of record.
 */
export const getLeafletCoverage = async (): Promise<LeafletCoverageRow[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_sku_leaflet_coverage', {
      order: { column: 'sku_number', ascending: true },
    }),
    '[leaflet-coverage] getLeafletCoverage',
  );
  return rows.map(mapCoverage);
};

export interface LeafletPolicy {
  id: string;
  categoryId: string;
  mode: LeafletMode;
  updatedBy: string | null;
  updatedAt: string;
}

const mapPolicy = (r: Row): LeafletPolicy => ({
  id: r.id,
  categoryId: r.category_id,
  mode: (r.mode as LeafletMode) ?? 'category',
  updatedBy: r.updated_by ?? null,
  updatedAt: r.updated_at,
});

/** Explicit policies only. A category with no row is 'category' mode — see migration 132. */
export const getLeafletPolicies = async (): Promise<LeafletPolicy[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_leaflet_policies', { where: { template_type: TEMPLATE_TYPE } }),
    '[leaflet-coverage] getLeafletPolicies',
  );
  return rows.map(mapPolicy);
};

/**
 * Set whether a category's leaflet is generic or per-SKU.
 *
 * Switching mode NEVER deletes issues: rows of the other kind survive and simply stop
 * resolving, so a mis-click is reversible and the coverage tab can report them as inactive.
 * Safe to upsert — im_leaflet_policies' unique index is total, not partial.
 */
export const setLeafletPolicy = async (
  categoryId: string,
  mode: LeafletMode,
  updatedBy?: string | null,
): Promise<LeafletPolicy> => {
  if (!isLive) throw new Error('Database not configured.');
  const stored = await db.upsertReturning<Row>(
    'im_leaflet_policies',
    {
      category_id: categoryId,
      template_type: TEMPLATE_TYPE,
      mode,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'category_id,template_type' },
  );
  return mapPolicy(stored);
};

export interface LeafletIssue {
  id: string;
  categoryId: string;
  /** NULL = covers every SKU in the category. */
  skuNumber: string | null;
  renderId: string | null;
  note: string | null;
  issuedBy: string | null;
  issuedAt: string;
}

const mapIssue = (r: Row): LeafletIssue => ({
  id: r.id,
  categoryId: r.category_id,
  skuNumber: r.sku_number ?? null,
  renderId: r.render_id ?? null,
  note: r.note ?? null,
  issuedBy: r.issued_by ?? null,
  issuedAt: r.issued_at,
});

/** Every issue row, for the coverage tab's per-category breakdown and orphan reporting. */
export const getLeafletIssues = async (): Promise<LeafletIssue[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_leaflet_issues', {
      where: { template_type: TEMPLATE_TYPE },
      order: { column: 'issued_at', ascending: false },
    }),
    '[leaflet-coverage] getLeafletIssues',
  );
  return rows.map(mapIssue);
};

export interface IssueMeta {
  note?: string | null;
  by?: string | null;
}

/**
 * Issue a render as the GENERIC leaflet for a whole category: one row, sku_number NULL.
 *
 * Every SKU in the category — including ones imported later — resolves to it, because no
 * per-SKU row is the mechanism. Re-issuing repoints the same row rather than adding one.
 */
export const issueCategoryLeaflet = async (
  categoryId: string,
  renderId: string,
  meta: IssueMeta = {},
): Promise<LeafletIssue> => {
  if (!isLive) throw new Error('Database not configured.');
  const now = new Date().toISOString();
  const existing = await db.selectMaybeOne<Row>('im_leaflet_issues', {
    columns: 'id',
    where: { category_id: categoryId, template_type: TEMPLATE_TYPE, sku_number: null },
  });
  const values = {
    render_id: renderId,
    note: meta.note ?? null,
    issued_by: meta.by ?? null,
    issued_at: now,
    updated_at: now,
  };
  if (existing) {
    const updated = await db.update<Row>('im_leaflet_issues', values, {
      where: { id: existing.id },
    });
    return mapIssue(updated);
  }
  const created = await db.insert<Row>('im_leaflet_issues', {
    category_id: categoryId,
    template_type: TEMPLATE_TYPE,
    sku_number: null,
    ...values,
  });
  return mapIssue(created);
};

export interface IssueForSkusResult {
  assigned: number;
  reassigned: number;
}

/**
 * Issue a render as the leaflet for specific SKU numbers — the SKU-specific case.
 *
 * All of them share one render_id, which is what "these SKUs together get this leaflet"
 * means: they are the group whose data is inside that PDF. Re-running with the same numbers
 * repoints them (`reassigned`) instead of duplicating, and a number already pointing at a
 * DIFFERENT render is moved — issuing is authoritative, since the caller just chose which PDF
 * these SKUs get.
 *
 * Callers pass the render's bound SKU numbers, resolved with `resolveBoundSkuNumbers` in
 * project-im.service.ts. Nothing here free-types a SKU number; see migration 132, decision 3.
 */
export const issueLeafletForSkus = async (
  categoryId: string,
  renderId: string,
  skuNumbers: readonly string[],
  meta: IssueMeta = {},
): Promise<IssueForSkusResult> => {
  if (!isLive) throw new Error('Database not configured.');
  const numbers = Array.from(
    new Set(skuNumbers.map((n) => n.trim()).filter((n) => n.length > 0)),
  );
  const result: IssueForSkusResult = { assigned: 0, reassigned: 0 };
  if (!numbers.length) return result;

  const now = new Date().toISOString();
  const existing = await db.select<Row>('im_leaflet_issues', {
    columns: 'id, sku_number',
    where: { template_type: TEMPLATE_TYPE, sku_number: numbers },
  });
  const idByNumber = new Map<string, string>();
  for (const r of existing) if (r.sku_number) idByNumber.set(r.sku_number, r.id);

  const values = {
    category_id: categoryId,
    render_id: renderId,
    note: meta.note ?? null,
    issued_by: meta.by ?? null,
    issued_at: now,
    updated_at: now,
  };

  const fresh = numbers.filter((n) => !idByNumber.has(n));
  if (fresh.length) {
    await db.insertMany(
      'im_leaflet_issues',
      fresh.map((n) => ({ ...values, template_type: TEMPLATE_TYPE, sku_number: n })),
    );
    result.assigned = fresh.length;
  }
  // One statement for the whole re-point: every id shares the same new render.
  const staleIds = numbers.map((n) => idByNumber.get(n)).filter(Boolean) as string[];
  if (staleIds.length) {
    await db.updateWhere('im_leaflet_issues', values, { where: { id: staleIds } });
    result.reassigned = staleIds.length;
  }
  return result;
};

/** Withdraw one issue. The affected SKUs fall back to the category-wide leaflet, or to a gap. */
export const withdrawLeafletIssue = async (issueId: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('im_leaflet_issues', { where: { id: issueId } });
};
