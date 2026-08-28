/**
 * Compliance category service
 * Manages compliance categories and product features
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { CategoryL1, CategoryL2, CategoryL3, CategoryTree } from '../../types';

/**
 * Get the two parent levels of the category tree (L1 > L2).
 *
 * Fetched as two flat selects and joined in memory rather than as a nested PostgREST
 * embed: the tree is ~60 rows, and keeping it flat leaves PORTING.md's list of
 * embedded joins (the one non-portable projection) exactly as long as it was.
 */
export const getCategoryTree = async (): Promise<CategoryTree> => {
    if (!isLive) return { l1: [], l2: [] };
    const [l1Rows, l2Rows] = await Promise.all([
        orEmpty(portalDb.select<Row>('categories_l1', { columns: '*' }), 'getCategoryTree.l1'),
        orEmpty(portalDb.select<Row>('categories_l2', { columns: '*' }), 'getCategoryTree.l2'),
    ]);
    const bySort = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
    return {
        l1: l1Rows.map((r: any): CategoryL1 => ({
            id: r.id, name: r.name, sortOrder: r.sort_order ?? 0, active: r.active,
        })).sort(bySort),
        l2: l2Rows.map((r: any): CategoryL2 => ({
            id: r.id, l1Id: r.l1_id, name: r.name, sortOrder: r.sort_order ?? 0, active: r.active,
        })).sort(bySort),
    };
};

/**
 * Get all compliance categories (L3 leaves), joined with the assigned PM's name and
 * denormalised with their L1/L2 parents.
 *
 * Leaves are returned in tree order — L1, then L2, then the leaf's own sort_order — so
 * every table and grouped picker in the app shows the same sequence without re-sorting.
 * A leaf with no parent (l2Id null) is uncategorised and sorts last.
 */
export const getCategories = async (): Promise<CategoryL3[]> => {
    if (!isLive) return [];
    const [rows, tree] = await Promise.all([
        orEmpty(
            // Server-side join on the PM profile — see PORTING.md, one of the embedded selects
            // a non-PostgREST adapter must express as a real JOIN.
            portalDb.select<Row>('categories_l3', { columns: '*, pm:profiles!pm_id(id, name)' }),
            'getCategories',
        ),
        getCategoryTree(),
    ]);

    const l1ById = new Map(tree.l1.map(l => [l.id, l]));
    const l2ById = new Map(tree.l2.map(l => [l.id, l]));

    const mapped = rows.map((c: any): CategoryL3 => {
        const l2 = c.l2_id ? l2ById.get(c.l2_id) : undefined;
        const l1 = l2 ? l1ById.get(l2.l1Id) : undefined;
        return {
            id: c.id,
            name: c.name,
            active: c.active,
            isFinalized: c.is_finalized,
            finalizedAt: c.finalized_at,
            pmId: c.pm_id ?? null,
            pmName: c.pm?.name ?? null,
            l2Id: c.l2_id ?? null,
            l2Name: l2?.name ?? null,
            l1Id: l1?.id ?? null,
            l1Name: l1?.name ?? null,
            sortOrder: c.sort_order ?? 0,
        };
    });

    // Uncategorised leaves sort after everything else rather than being hidden.
    const rank = (c: CategoryL3) => {
        const l2 = c.l2Id ? l2ById.get(c.l2Id) : undefined;
        const l1 = l2 ? l1ById.get(l2.l1Id) : undefined;
        return l2 && l1 ? [0, l1.sortOrder, l2.sortOrder, c.sortOrder ?? 0] : [1, 0, 0, 0];
    };
    return mapped.sort((a, b) => {
        const [ra, rb] = [rank(a), rank(b)];
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
        return a.name.localeCompare(b.name);
    });
};

/**
 * Save/update a compliance category (supports pm_id assignment and re-parenting).
 */
export const saveCategory = async (cat: CategoryL3): Promise<void> => {
    await db.upsert('categories_l3', {
        id: cat.id,
        name: cat.name,
        active: cat.active,
        is_finalized: cat.isFinalized,
        finalized_at: cat.finalizedAt,
        pm_id: cat.pmId ?? null,
        l2_id: cat.l2Id ?? null
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
