/**
 * Validation helpers for category attribute values (type/required checks and per-category lookup).
 */
import { CategoryAttribute } from '../types';

/**
 * Returns all attributes visible for a given category:
 * - Attributes where categoryId matches (Category Specific)
 * - Attributes where categoryId is null (global predefined groups, shared across all categories)
 */
export function getAttributesForCategory(all: CategoryAttribute[], categoryId: string): CategoryAttribute[] {
  return all.filter(a =>
    a.categoryId === categoryId ||
    a.categoryId === null ||
    (a.assignedCategoryIds ?? []).includes(categoryId)
  );
}

/**
 * The attributes a category asks an EXTERNAL SUPPLIER for — `getAttributesForCategory`
 * minus everything marked internal.
 *
 * Every supplier-facing list goes through this rather than filtering at the call site, so
 * there is one place to audit and a new surface cannot forget the rule. Today that is the
 * token attribute portal (form and its XLSX export), the supplier portal's proposal form,
 * and the RFQ builder — a PM-facing screen, but what it builds is sent to suppliers.
 *
 * Only an explicit `false` hides an attribute: an undefined flag (an older row, or one read
 * before migration 134) stays visible rather than silently disappearing from a supplier form.
 *
 * This governs what is DISPLAYED. It is not access control — category_attributes is still
 * publicly readable under RLS, so an internal attribute is hidden, not protected.
 */
export function getSupplierVisibleAttributes(all: CategoryAttribute[], categoryId: string): CategoryAttribute[] {
  return getAttributesForCategory(all, categoryId).filter(a => a.supplierVisible !== false);
}

export function validateAttributeValue(
  attr: CategoryAttribute,
  value: string,
  mode: 'fixed' | 'range' | 'text' | 'multi-select',
  values?: string[]  // for multi-select enum
): string | null {
  const rules = attr.validationRules;
  const trimmed = value.trim();

  // ── Multi-select enum validation ──────────────────────────────────────────
  if (attr.dataType === 'enum' && mode === 'multi-select') {
    if (rules?.required && (!values || values.length === 0)) {
      return 'Please select at least one option';
    }
    const options = rules?.enumOptions ?? [];
    if (values && options.length > 0 && values.some(v => !options.includes(v))) {
      return 'One or more selected options are invalid';
    }
    return null;
  }

  if (rules?.required && !trimmed) return 'Required';
  if (!trimmed) return null;

  if (attr.dataType === 'enum') {
    const options = rules?.enumOptions ?? [];
    if (options.length > 0 && !options.includes(trimmed)) {
      return `Must be one of: ${options.join(', ')}`;
    }
    return null;
  }

  if (attr.dataType === 'boolean') {
    if (trimmed !== 'true' && trimmed !== 'false') return 'Must be Yes or No';
    return null;
  }

  if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
    if (mode === 'range') {
      const parts = trimmed.split('-');
      if (parts.length !== 2) return 'Range format: min-max (e.g. 100-200)';
      const [lo, hi] = parts.map(p => Number(p.trim()));
      if (isNaN(lo) || isNaN(hi)) return 'Range values must be numbers';
      if (attr.dataType === 'integer' && (!Number.isInteger(lo) || !Number.isInteger(hi))) {
        return 'Range values must be integers';
      }
      if (rules?.min !== undefined && lo < rules.min) return `Min value is ${rules.min}`;
      if (rules?.max !== undefined && hi > rules.max) return `Max value is ${rules.max}`;
      if (lo > hi) return 'Min must be less than max';
      return null;
    }
    const n = Number(trimmed);
    if (isNaN(n)) return 'Must be a number';
    if (attr.dataType === 'integer' && !Number.isInteger(n)) return 'Must be a whole number';
    if (rules?.min !== undefined && n < rules.min) return `Min value is ${rules.min}`;
    if (rules?.max !== undefined && n > rules.max) return `Max value is ${rules.max}`;
    return null;
  }

  return null;
}
