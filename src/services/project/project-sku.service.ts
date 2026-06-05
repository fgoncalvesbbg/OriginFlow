import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectSku, SkuAttributeValue, ProjectAttributeRequest } from '../../types';
import { SKU_ATTRIBUTE_ID } from '../../config/compliance.constants';

export const MAX_SKUS_PER_PROJECT = 10;

const map = (r: any): ProjectSku => ({
  id: r.id,
  projectId: r.project_id,
  skuNumber: r.sku_number ?? '',
  skuTitle: r.sku_title ?? '',
  attributeValues: r.attribute_values ?? [],
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const getProjectSkus = async (projectId: string): Promise<ProjectSku[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('project_skus')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('getProjectSkus error:', error);
    return [];
  }
  return (data || []).map(map);
};

export const createProjectSku = async (
  projectId: string,
  skuNumber: string,
  skuTitle: string,
  attributeValues: SkuAttributeValue[] = [],
  sortOrder?: number
): Promise<ProjectSku> => {
  if (!isLive) throw new Error('Database not configured.');

  // Enforce the per-project cap (UI also guards, but re-check against the DB).
  const existing = await getProjectSkus(projectId);
  if (existing.length >= MAX_SKUS_PER_PROJECT) {
    throw new Error(`Maximum of ${MAX_SKUS_PER_PROJECT} SKUs per project reached.`);
  }

  const { data, error } = await supabase
    .from('project_skus')
    .insert({
      project_id: projectId,
      sku_number: skuNumber,
      sku_title: skuTitle,
      attribute_values: attributeValues,
      sort_order: sortOrder ?? existing.length,
    })
    .select()
    .single();

  if (error) {
    console.error('createProjectSku error:', error);
    throw new Error(error.message || 'Failed to create SKU');
  }
  return map(data);
};

export const updateProjectSku = async (
  id: string,
  updates: Partial<Pick<ProjectSku, 'skuNumber' | 'skuTitle' | 'attributeValues' | 'sortOrder'>>
): Promise<ProjectSku> => {
  if (!isLive) throw new Error('Database not configured.');

  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (updates.skuNumber !== undefined) payload.sku_number = updates.skuNumber;
  if (updates.skuTitle !== undefined) payload.sku_title = updates.skuTitle;
  if (updates.attributeValues !== undefined) payload.attribute_values = updates.attributeValues;
  if (updates.sortOrder !== undefined) payload.sort_order = updates.sortOrder;

  const { data, error } = await supabase
    .from('project_skus')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('updateProjectSku error:', error);
    throw new Error(error.message || 'Failed to update SKU');
  }
  return map(data);
};

export const deleteProjectSku = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const { error } = await supabase
    .from('project_skus')
    .delete()
    .eq('id', id);
  if (error) {
    console.error('deleteProjectSku error:', error);
    throw new Error(error.message || 'Failed to delete SKU');
  }
};

// ---------------------------------------------------------------------------
// Pure helpers (no DB) — shared by ProjectDetail and the IM generator
// ---------------------------------------------------------------------------

/** Latest submitted attribute request for a SKU number (newest first), if any. */
const getLatestSkuSubmission = (
  skuNumber: string,
  attrRequests: ProjectAttributeRequest[],
): ProjectAttributeRequest | undefined =>
  attrRequests
    .filter(r => r.skuNumber === skuNumber && r.status === 'submitted' && r.submittedData && r.submittedData.length > 0)
    .sort((a, b) => new Date(b.submittedAt!).getTime() - new Date(a.submittedAt!).getTime())[0];

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
