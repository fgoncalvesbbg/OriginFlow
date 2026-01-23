/**
 * Project IM service
 * Manages instruction manual generation for specific projects
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectIM } from '../../types';
import { handleError } from '../../utils/error.utils';

/**
 * Get project IM record
 */
export const getProjectIM = async (projectId: string): Promise<ProjectIM | null> => {
    if (!isLive) return null;
    const { data, error } = await supabase.from('project_ims').select('*').eq('project_id', projectId).maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
      id: data.id,
      templateId: data.template_id,
      placeholderData: data.placeholder_data,
      status: data.status,
      updatedAt: data.updated_at
    };
};

/**
 * Save/create project IM record
 */
export const saveProjectIM = async (projectId: string, templateId: string, placeholderData: Record<string, string>, status: 'draft' | 'generated'): Promise<ProjectIM> => {
    const { data: existing } = await supabase.from('project_ims').select('id').eq('project_id', projectId).maybeSingle();

    const payload = {
        project_id: projectId,
        template_id: templateId,
        placeholder_data: placeholderData,
        status,
        updated_at: new Date().toISOString()
    };

    if (existing) {
        const { data, error } = await supabase.from('project_ims').update(payload).eq('id', existing.id).select().single();
        if (error) handleError(error, 'saveProjectIM update');
        return {
          id: data.id,
          templateId: data.template_id,
          placeholderData: data.placeholder_data,
          status: data.status,
          updatedAt: data.updated_at
        };
    } else {
        const { data, error } = await supabase.from('project_ims').insert(payload).select().single();
        if (error) handleError(error, 'saveProjectIM insert');
        return {
          id: data.id,
          templateId: data.template_id,
          placeholderData: data.placeholder_data,
          status: data.status,
          updatedAt: data.updated_at
        };
    }
};

/**
 * Delete project IM record
 */
export const deleteProjectIM = async (projectId: string): Promise<void> => {
    await supabase.from('project_ims').delete().eq('id', projectId);
};
