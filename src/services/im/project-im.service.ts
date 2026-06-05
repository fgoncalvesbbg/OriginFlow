/**
 * Project IM service
 * Manages instruction manual generation for specific projects
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectIM, SKUContentValue, IMTemplateType, ProjectBlockAddition, ProjectExtraSection, InlineBlockRef } from '../../types';
import { handleError } from '../../utils/error.utils';

const mapProjectIMRow = (data: any): ProjectIM => ({
  id: data.id,
  templateId: data.template_id,
  templateType: (data.template_type ?? 'im') as IMTemplateType,
  placeholderData: data.placeholder_data,
  skuContent: data.sku_content ?? {},
  status: data.status,
  updatedAt: data.updated_at,
  version: data.version ?? 0,
  boundSkuIds: data.bound_sku_ids ?? [],
  sectionAdditions: data.section_additions ?? {},
  extraSections: data.extra_sections ?? [],
  sectionOverrides: data.section_overrides ?? {},
});

/**
 * Get a project's generated instance for a given template type (defaults to 'im').
 * A project holds at most one instance per type.
 */
export const getProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<ProjectIM | null> => {
    if (!isLive) return null;
    const { data, error } = await supabase
      .from('project_ims')
      .select('*')
      .eq('project_id', projectId)
      .eq('template_type', templateType)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return mapProjectIMRow(data);
};

/**
 * Save/create a project's instance for a given template type (defaults to 'im').
 */
export const saveProjectIM = async (
  projectId: string,
  templateId: string,
  placeholderData: Record<string, string>,
  status: 'draft' | 'generated',
  skuContent?: Record<string, SKUContentValue>,
  templateType: IMTemplateType = 'im',
  sectionAdditions?: Record<string, ProjectBlockAddition[]>,
  extraSections?: ProjectExtraSection[],
  sectionOverrides?: Record<string, InlineBlockRef[]>,
  // When set (on publish), persists this exact version number. Omitted on draft
  // saves so the stored version is left untouched.
  version?: number,
  // project_skus.id values this IM is bound to. Empty array = all project SKUs.
  boundSkuIds?: string[],
): Promise<ProjectIM> => {
    const { data: existing } = await supabase
      .from('project_ims')
      .select('id')
      .eq('project_id', projectId)
      .eq('template_type', templateType)
      .maybeSingle();

    const payload: Record<string, unknown> = {
        project_id: projectId,
        template_id: templateId,
        template_type: templateType,
        placeholder_data: placeholderData,
        sku_content: skuContent ?? {},
        section_additions: sectionAdditions ?? {},
        extra_sections: extraSections ?? [],
        section_overrides: sectionOverrides ?? {},
        status,
        updated_at: new Date().toISOString()
    };
    if (version !== undefined) payload.version = version;
    if (boundSkuIds !== undefined) payload.bound_sku_ids = boundSkuIds;

    if (existing) {
        const { data, error } = await supabase.from('project_ims').update(payload).eq('id', existing.id).select().single();
        if (error) handleError(error, 'saveProjectIM update');
        return mapProjectIMRow(data);
    } else {
        const { data, error } = await supabase.from('project_ims').insert(payload).select().single();
        if (error) handleError(error, 'saveProjectIM insert');
        return mapProjectIMRow(data);
    }
};

/**
 * Delete a project's instance for a given template type (defaults to 'im').
 */
export const deleteProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<void> => {
    const { error } = await supabase
      .from('project_ims')
      .delete()
      .eq('project_id', projectId)
      .eq('template_type', templateType);
    if (error) handleError(error, 'deleteProjectIM');
};

/**
 * Full project IM rows for every published ('generated') instance, paired with
 * their project id. Used by the staleness check, which re-resolves each one.
 */
export const getGeneratedProjectIMs = async (): Promise<Array<{ projectId: string; im: ProjectIM }>> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('project_ims')
    .select('*')
    .eq('status', 'generated');
  if (error || !data) return [];
  return data.map((row: any) => ({ projectId: row.project_id, im: mapProjectIMRow(row) }));
};

// ---------------------------------------------------------------------------
// Summary type for the All Manuals dashboard view
// ---------------------------------------------------------------------------

export interface ProjectIMSummary {
  id: string;
  projectId: string;        // projects.id (UUID) — used in URL
  projectName: string;
  categoryId: string | null;
  templateId: string;
  templateType: IMTemplateType;
  templateName: string | null;
  status: 'draft' | 'generated';
  updatedAt: string;
  skus: string[];            // SKU numbers on the project (a project can have several)
}

/**
 * Fetch all project IM records with their project name, category, and template name.
 * Used by the IM Dashboard's "All Manuals" tab.
 */
export const getAllProjectIMs = async (): Promise<ProjectIMSummary[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('project_ims')
    .select(`
      id,
      project_id,
      template_id,
      template_type,
      status,
      updated_at,
      bound_sku_ids,
      project:projects ( id, name, category_id ),
      template:im_templates ( name )
    `)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[getAllProjectIMs] error:', error);
    return [];
  }

  // Project SKUs (a project can have several), in display order, indexed by id and project.
  const skusByProject = new Map<string, string[]>();
  const skuNumberById = new Map<string, string>();
  const { data: skuRows } = await supabase
    .from('project_skus')
    .select('id, project_id, sku_number, sort_order')
    .order('sort_order', { ascending: true });
  for (const r of skuRows ?? []) {
    const num = (r.sku_number ?? '').trim();
    if (!num) continue;
    skuNumberById.set(r.id, num);
    const arr = skusByProject.get(r.project_id) ?? [];
    arr.push(num);
    skusByProject.set(r.project_id, arr);
  }

  return (data || []).map((row: any) => {
    const projectId = row.project?.id ?? row.project_id;
    // The IM's bound SKUs (numbers); empty/legacy binding falls back to all project SKUs.
    const boundIds: string[] = row.bound_sku_ids ?? [];
    const boundNumbers = boundIds.map((id) => skuNumberById.get(id)).filter(Boolean) as string[];
    const skus = boundNumbers.length ? boundNumbers : (skusByProject.get(projectId) ?? []);
    return {
      id: row.id,
      projectId,
      projectName: row.project?.name ?? 'Unknown Project',
      categoryId: row.project?.category_id ?? null,
      templateId: row.template_id,
      templateType: (row.template_type ?? 'im') as IMTemplateType,
      templateName: row.template?.name ?? null,
      status: row.status as 'draft' | 'generated',
      updatedAt: row.updated_at,
      skus,
    };
  });
};
