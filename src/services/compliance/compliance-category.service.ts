/**
 * Compliance category service
 * Manages compliance categories and product features
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { CategoryL3, ProductFeature } from '../../types';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all compliance categories
 */
export const getCategories = async (): Promise<CategoryL3[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('categories_l3').select('*');
    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        isFinalized: c.is_finalized,
        finalizedAt: c.finalized_at
    }));
};

/**
 * Create a new compliance category
 */
export const createCategory = async (name: string): Promise<CategoryL3> => {
    const newCat = { id: generateUUID(), name, active: true, isFinalized: false };
    await saveCategory(newCat);
    return newCat;
};

/**
 * Save/update a compliance category
 */
export const saveCategory = async (cat: CategoryL3): Promise<void> => {
    const payload = {
        id: cat.id,
        name: cat.name,
        active: cat.active,
        is_finalized: cat.isFinalized,
        finalized_at: cat.finalizedAt
    };
    const { error } = await supabase.from('categories_l3').upsert(payload);
    if (error) handleError(error, 'saveCategory');
};

/**
 * Delete a compliance category
 */
export const deleteCategory = async (id: string): Promise<void> => {
    await supabase.from('categories_l3').delete().eq('id', id);
};

/**
 * Get all product features
 */
export const getProductFeatures = async (): Promise<ProductFeature[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('product_features').select('*');
    if (error) return [];
    return (data || []).map((f: any) => ({
        id: f.id,
        categoryId: f.category_id,
        name: f.name,
        active: f.active
    }));
};

/**
 * Save/update a product feature
 */
export const saveProductFeature = async (feat: ProductFeature): Promise<void> => {
    const payload: any = {
        id: feat.id,
        name: feat.name,
        active: feat.active
    };
    if (feat.categoryId) {
        payload.category_id = feat.categoryId;
    }
    const { error } = await supabase.from('product_features').upsert(payload);
    if (error) handleError(error, 'saveFeature');
};

/**
 * Delete a product feature
 */
export const deleteProductFeature = async (id: string): Promise<void> => {
    await supabase.from('product_features').delete().eq('id', id);
};
