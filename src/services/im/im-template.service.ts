/**
 * IM template service
 * Manages instruction manual templates
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMTemplate, IMTemplateType } from '../../types';
import { handleError, generateUUID } from '../../utils';
import { normalizeIMTemplateMetadata } from '../../utils/im-template-metadata.utils';
import { runMutation } from '../core/db';

/**
 * Get all IM templates
 */
export const getIMTemplates = async (): Promise<IMTemplate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('im_templates').select('*');
    if (error) return [];
    return (data || []).map((t: any) => ({
      id: t.id,
      categoryId: t.category_id,
      templateType: (t.template_type ?? 'im') as IMTemplateType,
      name: t.name,
      languages: t.languages,
      isFinalized: t.is_finalized,
      finalizedAt: t.finalized_at,
      metadata: normalizeIMTemplateMetadata(t.metadata),
      updatedAt: t.updated_at,
      lastUpdatedBy: t.last_updated_by
    }));
};

/**
 * Get IM template by ID
 */
export const getIMTemplateById = async (id: string): Promise<IMTemplate | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('im_templates').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      templateType: (data.template_type ?? 'im') as IMTemplateType,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: normalizeIMTemplateMetadata(data.metadata),
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/**
 * Get IM template by category ID and type (defaults to the normal 'im').
 * A category holds at most one template per type.
 */
export const getIMTemplateByCategoryId = async (
  categoryId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate | undefined> => {
    if (!categoryId || !isLive) return undefined;
    const { data, error } = await supabase
      .from('im_templates')
      .select('*')
      .eq('category_id', categoryId)
      .eq('template_type', templateType)
      .single();
    if (error || !data) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      templateType: (data.template_type ?? 'im') as IMTemplateType,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: normalizeIMTemplateMetadata(data.metadata),
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/**
 * Create a new IM template
 */
export const createIMTemplate = async (
  categoryId: string,
  name: string,
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate> => {
    const { data, error } = await supabase.from('im_templates').insert({
        id: generateUUID(),
        category_id: categoryId,
        template_type: templateType,
        name,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString()
    }).select().single();
    if (error) handleError(error, 'createIMTemplate');
    if (!data) throw new Error('createIMTemplate: no data returned');
    return {
      id: data.id,
      categoryId: data.category_id,
      templateType: (data.template_type ?? 'im') as IMTemplateType,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: normalizeIMTemplateMetadata(data.metadata),
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/** Name of the shared, category-less template that project-based imports bind to. */
export const BLANK_TEMPLATE_NAME = 'Blank Standardized Template';

/**
 * Get (or lazily create) the single shared "blank" template of a given type. It has
 * NO category (category_id IS NULL) and NO sections — project-based IM imports bind
 * to it and put all their content in ProjectIM.extraSections, so no per-project or
 * per-category template is needed. Hidden from the Category Templates grid (which
 * iterates real categories). category_id is nullable and the resolver binds a project
 * IM strictly by template_id, so this is safe.
 */
export const getOrCreateBlankTemplate = async (
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate> => {
    const map = (data: any): IMTemplate => ({
      id: data.id,
      categoryId: data.category_id,
      templateType: (data.template_type ?? 'im') as IMTemplateType,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: normalizeIMTemplateMetadata(data.metadata),
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by,
    });

    const { data: existing } = await supabase
      .from('im_templates')
      .select('*')
      .is('category_id', null)
      .eq('template_type', templateType)
      .limit(1);
    if (existing && existing.length) return map(existing[0]);

    const { data, error } = await supabase.from('im_templates').insert({
        id: generateUUID(),
        category_id: null,
        template_type: templateType,
        name: BLANK_TEMPLATE_NAME,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString(),
    }).select().single();
    if (error) handleError(error, 'getOrCreateBlankTemplate');
    if (!data) throw new Error('getOrCreateBlankTemplate: no data returned');
    return map(data);
};

/**
 * Update IM template information
 */
export const updateIMTemplate = async (id: string, updates: Partial<IMTemplate>): Promise<void> => {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.metadata !== undefined) payload.metadata = JSON.parse(JSON.stringify(updates.metadata));
    if (updates.languages !== undefined) payload.languages = updates.languages;
    if (updates.lastUpdatedBy !== undefined) payload.last_updated_by = updates.lastUpdatedBy;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.isFinalized !== undefined) payload.is_finalized = updates.isFinalized;
    if (updates.finalizedAt !== undefined) payload.finalized_at = updates.finalizedAt;

    payload.updated_at = new Date().toISOString();

    await runMutation(supabase.from('im_templates').update(payload).eq('id', id), 'updateIMTemplate');
};

/**
 * Number of project IM instances generated from a template. These block a plain
 * delete because `project_ims.template_id` has no ON DELETE cascade — see
 * deleteIMTemplate.
 */
export const getProjectIMCountForTemplate = async (templateId: string): Promise<number> => {
    if (!templateId || !isLive) return 0;
    const { count, error } = await supabase
      .from('project_ims')
      .select('id', { count: 'exact', head: true })
      .eq('template_id', templateId);
    if (error) return 0;
    return count ?? 0;
};

/**
 * Delete a template and its sections (im_sections cascades via FK). If any project
 * manuals were generated from it, deletion is refused unless `force` is set, in
 * which case those project_ims rows are deleted first (otherwise the FK blocks it).
 * Publish snapshots / print renders / shares key off project_id, not the template,
 * so they are unaffected here (same as deleteProjectIM).
 */
export const deleteIMTemplate = async (
  id: string,
  opts: { force?: boolean } = {},
): Promise<void> => {
    const dependents = await getProjectIMCountForTemplate(id);
    if (dependents > 0 && !opts.force) {
      throw new Error(
        `Template is used by ${dependents} project manual(s); pass force to delete them too.`,
      );
    }
    if (dependents > 0) {
      await runMutation(supabase.from('project_ims').delete().eq('template_id', id), 'deleteIMTemplate:project_ims');
    }
    await runMutation(supabase.from('im_templates').delete().eq('id', id), 'deleteIMTemplate');
};
