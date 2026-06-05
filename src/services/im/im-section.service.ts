/**
 * IM section service
 * Manages sections within instruction manual templates
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMSection } from '../../types';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all sections for an IM template
 */
export const getIMSections = async (templateId: string): Promise<IMSection[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('im_sections').select('*').eq('template_id', templateId);
    if (error) return [];
    return (data || []).map((s: any) => ({
      id: s.id,
      templateId: s.template_id,
      parentId: s.parent_id,
      title: s.title,
      titleI18n: s.title_i18n ?? {},
      order: s.order,
      isPlaceholder: s.is_placeholder,
      content: s.content,
      conditionFeatureId: s.condition_feature_id ?? null,
      conditionLabel: s.condition_label ?? null,
      isFinal: s.is_final ?? false,
      completedLanguages: s.completed_languages ?? [],
      blockRefs: s.block_refs ?? [],
    }));
};

/**
 * Save/update an IM section
 */
export const saveIMSection = async (section: Partial<IMSection>): Promise<IMSection> => {
    const payload: any = {
        title: section.title,
        order: section.order,
        content: section.content
    };
    if (section.titleI18n !== undefined) payload.title_i18n = section.titleI18n;

    if (section.id) payload.id = section.id;
    else payload.id = generateUUID();

    if (section.templateId) payload.template_id = section.templateId;
    if (section.parentId) payload.parent_id = section.parentId;
    if (section.isPlaceholder !== undefined) payload.is_placeholder = section.isPlaceholder;
    if ('conditionFeatureId' in section) payload.condition_feature_id = section.conditionFeatureId ?? null;
    if ('conditionLabel' in section) payload.condition_label = section.conditionLabel ?? null;
    if (section.isFinal !== undefined) payload.is_final = section.isFinal;
    if (section.completedLanguages !== undefined) payload.completed_languages = section.completedLanguages;
    if (section.blockRefs !== undefined) payload.block_refs = section.blockRefs;

    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    const { data, error } = await supabase.from('im_sections').upsert(payload).select().single();
    if (error) handleError(error, 'saveIMSection');
    return {
      id: data.id,
      templateId: data.template_id,
      parentId: data.parent_id,
      title: data.title,
      titleI18n: data.title_i18n ?? {},
      order: data.order,
      isPlaceholder: data.is_placeholder,
      content: data.content,
      conditionFeatureId: data.condition_feature_id ?? null,
      conditionLabel: data.condition_label ?? null,
      isFinal: data.is_final ?? false,
      completedLanguages: data.completed_languages ?? [],
      blockRefs: data.block_refs ?? [],
    };
};

/**
 * Delete an IM section
 */
export const deleteIMSection = async (id: string): Promise<void> => {
    const { error } = await supabase.from('im_sections').delete().eq('id', id);
    if (error) handleError(error, 'deleteIMSection');
};
