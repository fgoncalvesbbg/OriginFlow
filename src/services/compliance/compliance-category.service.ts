/**
 * Compliance category service
 * Manages compliance categories and product features
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { CategoryL3 } from '../../types';

/**
 * Get all compliance categories, joined with the assigned PM's name
 */
export const getCategories = async (): Promise<CategoryL3[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        // Server-side join on the PM profile — see PORTING.md, one of the embedded selects
        // a non-PostgREST adapter must express as a real JOIN.
        portalDb.select<Row>('categories_l3', { columns: '*, pm:profiles!pm_id(id, name)' }),
        'getCategories',
    );
    return rows.map((c: any) => ({
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
    await db.upsert('categories_l3', {
        id: cat.id,
        name: cat.name,
        active: cat.active,
        is_finalized: cat.isFinalized,
        finalized_at: cat.finalizedAt,
        pm_id: cat.pmId ?? null
    });
};

/**
 * Assign (or unassign) a PM to a category
 */
export const assignPMToCategory = async (categoryId: string, pmId: string | null): Promise<void> => {
    await db.updateWhere('categories_l3', { pm_id: pmId }, { where: { id: categoryId } });
};

/**
 * Delete a compliance category
 */
export const deleteCategory = async (id: string): Promise<void> => {
    await db.delete('categories_l3', { where: { id } });
};
