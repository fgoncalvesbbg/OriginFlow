/**
 * IM section service
 * Manages sections within instruction manual templates
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMSection } from '../../types';
import { handleError, generateUUID } from '../../utils';
import { portalClient } from '../core/supabase.client';

/**
 * Get all sections for an IM template
 */
export const getIMSections = async (templateId: string): Promise<IMSection[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('im_sections').select('*').eq('template_id', templateId);
    if (error) return [];
    return (data || []).map((s: any) => ({
      id: s.id,
      templateId: s.template_id,
      parentId: s.parent_id,
      title: s.title,
      order: s.order,
      isPlaceholder: s.is_placeholder,
      content: s.content
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

    if (section.id) payload.id = section.id;
    else payload.id = generateUUID();

    if (section.templateId) payload.template_id = section.templateId;
    if (section.parentId) payload.parent_id = section.parentId;
    if (section.isPlaceholder !== undefined) payload.is_placeholder = section.isPlaceholder;

    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    const { data, error } = await supabase.from('im_sections').upsert(payload).select().single();
    if (error) handleError(error, 'saveIMSection');
    return {
      id: data.id,
      templateId: data.template_id,
      parentId: data.parent_id,
      title: data.title,
      order: data.order,
      isPlaceholder: data.is_placeholder,
      content: data.content
    };
};

/**
 * Delete an IM section
 */
export const deleteIMSection = async (id: string): Promise<void> => {
    await supabase.from('im_sections').delete().eq('id', id);
};
