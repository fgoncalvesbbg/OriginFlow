/**
 * Compliance category service
 * Manages compliance categories and product features
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { CategoryL3 } from '../../types';
import { handleError } from '../../utils';
import { runMutation } from '../core/db';

/**
 * Get all compliance categories, joined with the assigned PM's name
 */
export const getCategories = async (): Promise<CategoryL3[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient
        .from('categories_l3')
        .select('*, pm:profiles!pm_id(id, name)');
    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        isFinalized: c.is_finalized,
        finalizedAt: c.finalized_at,
        pmId: c.pm_id ?? null,
        pmName: c.pm?.name ?? null
    }));
};

/**
 * Save/update a compliance category (supports pm_id assignment)
 */
export const saveCategory = async (cat: CategoryL3): Promise<void> => {
    const payload: any = {
        id: cat.id,
        name: cat.name,
        active: cat.active,
        is_finalized: cat.isFinalized,
        finalized_at: cat.finalizedAt,
        pm_id: cat.pmId ?? null
    };
    await runMutation(supabase.from('categories_l3').upsert(payload), 'saveCategory');
};

/**
 * Assign (or unassign) a PM to a category
 */
export const assignPMToCategory = async (categoryId: string, pmId: string | null): Promise<void> => {
    const { error } = await supabase
        .from('categories_l3')
        .update({ pm_id: pmId })
        .eq('id', categoryId);
    if (error) handleError(error, 'assignPMToCategory');
};

/**
 * Delete a compliance category
 */
export const deleteCategory = async (id: string): Promise<void> => {
    await runMutation(supabase.from('categories_l3').delete().eq('id', id), 'deleteCategory');
};

