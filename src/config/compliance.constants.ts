/**
 * Compliance module constants and default values
 */

import type { CategoryAttribute } from '../types/compliance.types';

// Reserved attribute id for the project's SKU identifier. Namespaced like the other
// synthetic fields (e.g. __cover_title) so it never collides with real (UUID) attribute ids.
// When referenced in an IM template it resolves to the project's SKU number(s), joined with
// ", " when the project defines multiple SKUs.
export const SKU_ATTRIBUTE_ID = '__sku';
export const SKU_ATTRIBUTE_NAME = 'SKU';

// Synthetic CategoryAttribute used to offer "SKU" in attribute pickers (IM template editor)
// and to resolve its display name in the IM generator. Not persisted — built on demand.
export const skuSyntheticAttribute = (): CategoryAttribute => ({
  id: SKU_ATTRIBUTE_ID,
  categoryId: null,
  name: SKU_ATTRIBUTE_NAME,
  dataType: 'text',
});

export const ATTRIBUTE_GROUPS = [
    // Order here IS the display order: every list, grid and picker sections attributes by
    // indexOf on this array (see attributeGroupRank). 'Global' is deliberately first so
    // cross-category attributes always sit at the top.
    'Global',
    // 'Category Specific' is the only category-scoped group (carries a real category_id).
    'Category Specific',
    // Global/predefined groups (category_id = null, shared across every category).
    'Segmentation',
    'Variation Axes',
    'Standard Electric Specs',
    'Product Dimensions',
    'Battery Information',
    'Packaging',
    'Accessories',
    'Product Images',
] as const;

// Global/predefined groups: attributes here have category_id = null and apply to every
// category (see saveCategoryAttribute and getAttributesForCategory). This is an EXPLICIT
// list — everything except 'Category Specific'. 'Product Images' is additionally seeded by
// db_migrations/51_add_product_images_attribute_group.sql.
export const PREDEFINED_ATTRIBUTE_GROUPS = [
    // 'Global' is the catch-all for attributes that belong to every category without
    // fitting one of the named groups below (SKU, Product Name, Project ID...).
    'Global',
    'Segmentation',
    'Variation Axes',
    'Standard Electric Specs',
    'Product Dimensions',
    'Battery Information',
    'Packaging',
    'Accessories',
    'Product Images',
] as unknown as string[];

/**
 * Sort key for an attribute's group — its position in ATTRIBUTE_GROUPS, with anything
 * unrecognised sorted last. Single source of the section order shared by the admin list and
 * grid, the SKU catalog, the attribute viewer and the import preview.
 */
export const attributeGroupRank = (group?: string): number => {
    const i = (ATTRIBUTE_GROUPS as readonly string[]).indexOf(group ?? 'Category Specific');
    return i === -1 ? ATTRIBUTE_GROUPS.length : i;
};

/**
 * The canonical order of attributes anywhere they are listed: group first (ATTRIBUTE_GROUPS
 * order, Global at the top), then the explicit per-group sort_order, then name as the
 * tie-breaker.
 *
 * sort_order 0 means "not explicitly ordered", so an untouched group still reads
 * alphabetically exactly as it did before migration 137, and a group someone has arranged
 * keeps that arrangement. Applied centrally in getCategoryAttributes so every consumer —
 * admin grid and list, SKU catalog, attribute viewer, and every supplier-facing form —
 * inherits one order without each having to re-sort.
 */
export const compareAttributes = (
    a: { group?: string; sortOrder?: number; name: string },
    b: { group?: string; sortOrder?: number; name: string },
): number =>
    attributeGroupRank(a.group) - attributeGroupRank(b.group) ||
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
    a.name.localeCompare(b.name);

/**
 * The groups present in a set of attributes, in the order they should be displayed.
 *
 * Attributes arrive already sorted (compareAttributes), so a group's position is simply where
 * its first attribute lands. That is what makes ProductToolkit's own clusters work as groups
 * without being registered anywhere: PT's sortOrder is category-wide and its clusters are
 * contiguous within it, so first-appearance order reproduces PT's intended section order
 * exactly. Iterating ATTRIBUTE_GROUPS instead would silently DROP any group not on that list.
 */
export const groupsInOrder = (attrs: { group?: string }[]): string[] => {
    const seen: string[] = [];
    for (const a of attrs) {
        const g = a.group || 'Category Specific';
        if (!seen.includes(g)) seen.push(g);
    }
    return seen;
};

export const COMPLIANCE_SECTIONS = [
    'General Requirements',
    'Safety & Electrical',
    'Chemical & Material',
    'Mechanical & Physical',
    'Packaging & Labeling',
    'Performance & Testing'
];
