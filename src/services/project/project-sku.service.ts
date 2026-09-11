/**
 * Project SKU service — CRUD for the SKUs (product variants) attached to a project, including
 * effective attribute-value resolution.
 */
import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectSku, SkuAttributeValue, ProjectAttributeRequest } from '../../types';
import { SKU_ATTRIBUTE_ID } from '../../config/compliance.constants';
import { syncValueRowsFromJsonb } from './sku-attribute-value.service';

export const MAX_SKUS_PER_PROJECT = 20;

export const mapProjectSku = (r: any): ProjectSku => ({
  id: r.id,
  projectId: r.project_id ?? null,
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
});

const map = mapProjectSku;

export const getProjectSkus = async (projectId: string): Promise<ProjectSku[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_skus', {
      where: { project_id: projectId },
      order: { column: 'sort_order', ascending: true },
    }),
    'getProjectSkus',
  );
  return rows.map(map);
};

/** A SKU that exists somewhere in OriginFlow, for pickers that reach across projects. */
export interface KnownSku {
  skuNumber: string;
  skuTitle: string;
  /** How many projects (launches and re-edits) already carry this SKU number. */
  occurrences: number;
}

/**
 * Every distinct SKU number known to OriginFlow, newest first.
 *
 * There is no global SKU catalogue table — `project_skus` IS the SKU universe, one row per
 * SKU per project. The Re-Edit form needs to pick a SKU that is already live, i.e. one that
 * exists on some earlier project, so it de-duplicates by number here and copies the number
 * and title onto rows of its own.
 */
export const getKnownSkus = async (): Promise<KnownSku[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_skus', {
      columns: 'sku_number, sku_title, created_at',
      order: { column: 'created_at', ascending: false },
      limit: 5000,
    }),
    'getKnownSkus',
  );

  const byNumber = new Map<string, KnownSku>();
  for (const r of rows) {
    const skuNumber = String((r as any).sku_number ?? '').trim();
    if (!skuNumber) continue;
    const seen = byNumber.get(skuNumber);
    if (seen) { seen.occurrences += 1; continue; }
    // First row wins the title because the read is newest-first — the most recent spelling
    // of a SKU's name is the one worth showing.
    byNumber.set(skuNumber, { skuNumber, skuTitle: String((r as any).sku_title ?? ''), occurrences: 1 });
  }
  return [...byNumber.values()];
};

export const createProjectSku = async (
  projectId: string,
  skuNumber: string,
  skuTitle: string,
  attributeValues: SkuAttributeValue[] = [],
  sortOrder?: number,
  categoryId?: string | null,
): Promise<ProjectSku> => {
  if (!isLive) throw new Error('Database not configured.');

  // Enforce the per-project cap (UI also guards, but re-check against the DB).
  const existing = await getProjectSkus(projectId);
  if (existing.length >= MAX_SKUS_PER_PROJECT) {
    throw new Error(`Maximum of ${MAX_SKUS_PER_PROJECT} SKUs per project reached.`);
  }

  // Stamp the project's own category onto the SKU at creation time. Nothing in OriginFlow's
  // UI reads sku.categoryId back (attribute resolution goes through project.categoryId), but
  // external consumers reading the SKU row directly — the ProductToolkit readback API — do,
  // so a SKU created here must not be left with category_id null.
  const created = await db.insert<Row>('project_skus', {
    project_id: projectId,
    category_id: categoryId ?? null,
    sku_number: skuNumber,
    sku_title: skuTitle,
    attribute_values: attributeValues,
    sort_order: sortOrder ?? existing.length,
  });
  return map(created);
};

export const updateProjectSku = async (
  id: string,
  updates: Partial<Pick<ProjectSku, 'skuNumber' | 'skuTitle' | 'attributeValues' | 'sortOrder' | 'categoryId'>>
): Promise<ProjectSku> => {
  if (!isLive) throw new Error('Database not configured.');

  // Any data edit marks the SKU as needing a fresh Akeneo export.
  const payload: Record<string, any> = { updated_at: new Date().toISOString(), pending_export: true };
  if (updates.skuNumber !== undefined) payload.sku_number = updates.skuNumber;
  if (updates.skuTitle !== undefined) payload.sku_title = updates.skuTitle;
  if (updates.attributeValues !== undefined) payload.attribute_values = updates.attributeValues;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;
  if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;

  const updated = await db.update<Row>('project_skus', payload, { where: { id } });

  // Keep the row-level value store (sku_attribute_values, migration 155) in line with the
  // array this just wrote. It is the authoritative store; attribute_values is its mirror.
  // Done here rather than at the three call sites so a fourth cannot forget.
  //
  // Failures are logged, not thrown: the array write above has already succeeded and is
  // what every current reader uses (the ProductToolkit readback API, the IM placeholder
  // wizard, the request-prefill paths). Turning a successful SKU save into an
  // error because a secondary sync failed — or because migration 155 is not applied yet —
  // would be a worse outcome than a mirror that is briefly ahead of the rows.
  if (updates.attributeValues !== undefined) {
    try {
      await syncValueRowsFromJsonb({ projectSkuId: id, values: updates.attributeValues });
    } catch (e) {
      console.error('[updateProjectSku] value-row sync failed; attribute_values was still saved', e);
    }
  }

  return map(updated);
};

export const deleteProjectSku = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('project_skus', { where: { id } });
};

// ---------------------------------------------------------------------------
// Pure helpers (no DB) — shared by ProjectDetail and the IM generator
// ---------------------------------------------------------------------------

/**
 * Sort key for a submission's timestamp. `submittedAt` is nullable (and a stray unparsable
 * value is possible too), and `new Date(null-ish).getTime()` is NaN — a NaN comparator result
 * makes Array.prototype.sort's outcome unspecified, so a submission with no timestamp could
 * end up anywhere, including first. Missing/unparsable sorts as -Infinity — i.e. treated as
 * the OLDEST possible — so it can never silently outrank a submission that DOES carry a real
 * timestamp; the only way it wins is if every candidate is equally undated.
 */
const submissionTime = (r: ProjectAttributeRequest): number => {
  if (!r.submittedAt) return -Infinity;
  const t = new Date(r.submittedAt).getTime();
  return Number.isFinite(t) ? t : -Infinity;
};

/** Latest submitted attribute request for a SKU number (newest first), if any. */
const getLatestSkuSubmission = (
  skuNumber: string,
  attrRequests: ProjectAttributeRequest[],
): ProjectAttributeRequest | undefined =>
  attrRequests
    .filter(r => r.skuNumber === skuNumber && r.status === 'submitted' && r.submittedData && r.submittedData.length > 0)
    .sort((a, b) => submissionTime(b) - submissionTime(a))[0];

/**
 * Effective value for one attribute on one SKU: the latest supplier-submitted value wins,
 * falling back to the PM-entered value stored on the SKU itself. Returns '' when neither set.
 */
export const getEffectiveSkuValue = (
  sku: ProjectSku,
  attrRequests: ProjectAttributeRequest[],
  attributeId: string,
): string => {
  const submitted = getLatestSkuSubmission(sku.skuNumber, attrRequests)
    ?.submittedData?.find(d => d.attributeId === attributeId)?.value;
  if (submitted) return submitted;
  return sku.attributeValues.find(v => v.attributeId === attributeId)?.value || '';
};

/**
 * Collapse per-SKU attribute values into a flat { attributeId -> displayValue } map for IM
 * resolution. For each attribute, gathers its effective value across every SKU, then:
 *   - text/number attrs: distinct non-empty values joined with ", " (single value when all agree)
 *   - image attrs (id in imageAttrIds): the first non-empty value (image markup can't be joined)
 * Also adds SKU_ATTRIBUTE_ID -> the project's SKU numbers (distinct), joined with ", ".
 * Returns {} for an empty SKU list.
 */
export const collapseSkuAttributeValues = (
  skus: ProjectSku[],
  attrRequests: ProjectAttributeRequest[],
  imageAttrIds?: Set<string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (skus.length === 0) return out;

  // Every attribute id referenced by any SKU's own values or its latest submission.
  const attrIds = new Set<string>();
  for (const sku of skus) {
    for (const v of sku.attributeValues) attrIds.add(v.attributeId);
    for (const d of getLatestSkuSubmission(sku.skuNumber, attrRequests)?.submittedData ?? []) {
      attrIds.add(d.attributeId);
    }
  }

  for (const attrId of attrIds) {
    const values = skus
      .map(sku => getEffectiveSkuValue(sku, attrRequests, attrId).trim())
      .filter(Boolean);
    if (values.length === 0) { out[attrId] = ''; continue; }

    if (imageAttrIds?.has(attrId)) {
      out[attrId] = values[0]; // can't comma-join image markup
    } else {
      out[attrId] = Array.from(new Set(values)).join(', ');
    }
  }

  // The SKU identifier itself — numbers are unique per project, so distinct == all.
  out[SKU_ATTRIBUTE_ID] = Array.from(new Set(skus.map(s => s.skuNumber.trim()).filter(Boolean))).join(', ');

  return out;
};
