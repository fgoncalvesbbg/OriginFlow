/**
 * IM template service
 * Manages instruction manual templates
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMTemplate } from '../../types';
import { handleError, generateUUID } from '../../utils';

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
      name: t.name,
      languages: t.languages,
      isFinalized: t.is_finalized,
      finalizedAt: t.finalized_at,
      metadata: t.metadata,
      updatedAt: t.updated_at,
      lastUpdatedBy: t.last_updated_by
    }));
};

/**
 * Get IM template by ID
 */
export const getIMTemplateById = async (id: string): Promise<IMTemplate | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await portalClient.from('im_templates').select('*').eq('id', id).single();
    if (error) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/**
 * Get IM template by category ID
 */
export const getIMTemplateByCategoryId = async (categoryId: string): Promise<IMTemplate | undefined> => {
    if (!categoryId || !isLive) return undefined;
    const { data, error } = await supabase.from('im_templates').select('*').eq('category_id', categoryId).single();
    if (error) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/**
 * Create a new IM template
 */
export const createIMTemplate = async (categoryId: string, name: string): Promise<IMTemplate> => {
    const { data, error } = await supabase.from('im_templates').insert({
        id: generateUUID(),
        category_id: categoryId,
        name,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString()
    }).select().single();
    if (error) handleError(error, 'createIMTemplate');
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

/**
 * Update IM template information
 */
export const updateIMTemplate = async (id: string, updates: Partial<IMTemplate>): Promise<void> => {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.metadata !== undefined) payload.metadata = updates.metadata;
    if (updates.languages !== undefined) payload.languages = updates.languages;
    if (updates.lastUpdatedBy !== undefined) payload.last_updated_by = updates.lastUpdatedBy;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.isFinalized !== undefined) payload.is_finalized = updates.isFinalized;
    if (updates.finalizedAt !== undefined) payload.finalized_at = updates.finalizedAt;

    payload.updated_at = new Date().toISOString();

    await supabase.from('im_templates').update(payload).eq('id', id);
};
