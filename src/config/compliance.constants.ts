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
    'Category Specific',
    'Standard Electric Specs',
    'Product Dimensions',
    'Battery Information',
    'Packaging',
    'Accessories',
    'Product Images',
] as const;

// Standard image-slot attributes that live in the global "Product Images" group.
// These are seeded by db_migrations/51_add_product_images_attribute_group.sql and
// apply to every category (category_id = null). Listed here so the UI/IM editor can
// recognise the canonical image slots without another DB round-trip.
export const PRODUCT_IMAGES_GROUP = 'Product Images';
export const PRODUCT_IMAGE_SLOTS = [
    'Front',
    'Side',
    'Top',
    'Bottom',
    'Control Panel',
    'Remote',
    'Others',
] as const;

// Groups 2-6: always present on every category, cannot be removed
export const PREDEFINED_ATTRIBUTE_GROUPS = ATTRIBUTE_GROUPS.slice(1) as unknown as string[];

export const COMPLIANCE_SECTIONS = [
    'General Requirements',
    'Safety & Electrical',
    'Chemical & Material',
    'Mechanical & Physical',
    'Packaging & Labeling',
    'Performance & Testing'
];

export const DEFAULT_COMPLIANCE_REQUIREMENTS = [
    { section: 'General Requirements', requirement: 'Product registration' },
    { section: 'General Requirements', requirement: 'Quality certificate' },
    { section: 'Safety & Electrical', requirement: 'CE marking' },
    { section: 'Safety & Electrical', requirement: 'Electrical safety compliance' },
];
