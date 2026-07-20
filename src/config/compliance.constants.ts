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
    'Segmentation',
    'Variation Axes',
    'Standard Electric Specs',
    'Product Dimensions',
    'Battery Information',
    'Packaging',
    'Accessories',
    'Product Images',
] as unknown as string[];

export const COMPLIANCE_SECTIONS = [
    'General Requirements',
    'Safety & Electrical',
    'Chemical & Material',
    'Mechanical & Physical',
    'Packaging & Labeling',
    'Performance & Testing'
];
