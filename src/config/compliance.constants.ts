/**
 * Compliance module constants and default values
 */

export const ATTRIBUTE_GROUPS = [
    'Category Specific',
    'Standard Electric Specs',
    'Product Dimensions',
    'Battery Information',
    'Packaging',
    'Accessories',
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
