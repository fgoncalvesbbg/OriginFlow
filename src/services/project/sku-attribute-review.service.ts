/**
 * Attribute review service — powers the Attribute Viewer. Aggregates SKUs across every project in
 * an L3 category (for side-by-side comparison) and manages per-cell review flags/comments.
 * Editing an attribute value reuses updateProjectSku (the SKU row is the source of truth).
 */
import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectSku, SkuAttributeFlag } from '../../types';

/** A SKU enriched with its owning project's name, for column headers in the viewer. */
export interface CategorySku extends ProjectSku {
  projectName: string;
}

const mapSku = (r: any): CategorySku => ({
  id: r.id,
  projectId: r.project_id,
  skuNumber: r.sku_number ?? '',
  skuTitle: r.sku_title ?? '',
  attributeValues: r.attribute_values ?? [],
  sortOrder: r.sort_order ?? 0,
  isFinal: r.is_final ?? false,
  pendingExport: r.pending_export ?? false,
  lastExportedAt: r.last_exported_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  projectName: r.projects?.name ?? '',
});

/**
 * All SKUs belonging to projects in the given L3 category, across every project, ordered by SKU
 * number. Uses an inner join on projects so only SKUs whose project carries the category are returned.
 */
export const getSkusByCategory = async (categoryId: string): Promise<CategorySku[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('project_skus')
    .select('*, projects!inner(id, name, category_id)')
    .eq('projects.category_id', categoryId)
    .order('sku_number', { ascending: true });
  if (error) {
    console.error('getSkusByCategory error:', error);
    return [];
  }
  return (data || []).map(mapSku);
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
  const { data, error } = await supabase
    .from('sku_attribute_flags')
    .select('*')
    .in('project_sku_id', skuIds);
  if (error) {
    console.error('getFlagsForSkus error:', error);
    return [];
  }
  return (data || []).map(mapFlag);
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
  const { data, error } = await supabase
    .from('sku_attribute_flags')
    .upsert(
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
    )
    .select()
    .single();
  if (error) {
    console.error('upsertSkuAttributeFlag error:', error);
    throw new Error(error.message || 'Failed to save flag');
  }
  return mapFlag(data);
};

/** Mark a flag resolved (or re-open it). Stamps resolved_at when resolving. */
export const setSkuAttributeFlagResolved = async (
  id: string,
  resolved: boolean,
): Promise<SkuAttributeFlag> => {
  if (!isLive) throw new Error('Database not configured.');
  const { data, error } = await supabase
    .from('sku_attribute_flags')
    .update({
      status: resolved ? 'resolved' : 'open',
      resolved_at: resolved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('setSkuAttributeFlagResolved error:', error);
    throw new Error(error.message || 'Failed to update flag');
  }
  return mapFlag(data);
};

/** Remove a flag entirely. */
export const deleteSkuAttributeFlag = async (id: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const { error } = await supabase.from('sku_attribute_flags').delete().eq('id', id);
  if (error) {
    console.error('deleteSkuAttributeFlag error:', error);
    throw new Error(error.message || 'Failed to delete flag');
  }
};
