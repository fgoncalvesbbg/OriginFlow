/**
 * Covers the supplier-visibility filter — the one place that decides what an external
 * supplier is shown. Every supplier-facing surface goes through it, so these are the tests
 * that stop an internal attribute reaching a supplier form.
 */
import { describe, it, expect } from 'vitest';
import { getAttributesForCategory, getSupplierVisibleAttributes } from './attribute-validation.utils';
import type { CategoryAttribute } from '../types';

const CAT = 'cat-angled-hoods';
const OTHER = 'cat-beverage-coolers';

const a = (over: Partial<CategoryAttribute> & { id: string; name: string }): CategoryAttribute => ({
  categoryId: CAT, assignedCategoryIds: [], dataType: 'text', group: 'Category Specific', ...over,
});

const all: CategoryAttribute[] = [
  a({ id: 'own-visible', name: 'Airflow max' }),
  a({ id: 'own-internal', name: 'Internal margin note', supplierVisible: false }),
  a({ id: 'own-explicit', name: 'Duct outlet', supplierVisible: true }),
  a({ id: 'global-visible', name: 'Power', categoryId: null, group: 'Standard Electric Specs' }),
  a({ id: 'global-internal', name: 'Project ID', categoryId: null, group: 'Segmentation', supplierVisible: false }),
  a({ id: 'shared-internal', name: 'Cost band', categoryId: OTHER, assignedCategoryIds: [CAT], supplierVisible: false }),
  a({ id: 'shared-visible', name: 'Defrost Type', categoryId: OTHER, assignedCategoryIds: [CAT] }),
  a({ id: 'elsewhere', name: 'No. of Bottles', categoryId: OTHER }),
];

const names = (rows: CategoryAttribute[]) => rows.map(r => r.name).sort();

describe('getSupplierVisibleAttributes', () => {
  it('drops every attribute marked internal, whatever its scope', () => {
    const visible = getSupplierVisibleAttributes(all, CAT);
    expect(names(visible)).toEqual(['Airflow max', 'Defrost Type', 'Duct outlet', 'Power']);
    for (const hidden of ['Internal margin note', 'Project ID', 'Cost band']) {
      expect(names(visible)).not.toContain(hidden);
    }
  });

  it('hides an internal GLOBAL attribute — the case a category-scoped filter would miss', () => {
    const visible = getSupplierVisibleAttributes(all, CAT);
    expect(visible.find(r => r.id === 'global-internal')).toBeUndefined();
    expect(visible.find(r => r.id === 'global-visible')).toBeDefined();
  });

  it('hides an internal attribute shared in from another category', () => {
    const visible = getSupplierVisibleAttributes(all, CAT);
    expect(visible.find(r => r.id === 'shared-internal')).toBeUndefined();
    expect(visible.find(r => r.id === 'shared-visible')).toBeDefined();
  });

  it('treats an undefined flag as visible, so pre-migration rows still appear', () => {
    // Rows written before migration 134 have no flag at all. Defaulting them to hidden
    // would silently empty every supplier form.
    const legacy = [a({ id: 'legacy', name: 'Legacy attribute' })];
    expect(legacy[0].supplierVisible).toBeUndefined();
    expect(getSupplierVisibleAttributes(legacy, CAT)).toHaveLength(1);
  });

  it('only an explicit false hides — not a falsy-ish value', () => {
    const odd = [
      a({ id: 'undef', name: 'Undefined' }),
      a({ id: 'true', name: 'True', supplierVisible: true }),
      a({ id: 'false', name: 'False', supplierVisible: false }),
    ];
    expect(names(getSupplierVisibleAttributes(odd, CAT))).toEqual(['True', 'Undefined']);
  });

  it('still excludes attributes belonging to another category entirely', () => {
    expect(names(getSupplierVisibleAttributes(all, CAT))).not.toContain('No. of Bottles');
  });

  it('is exactly the internal list minus the internal-only rows', () => {
    // The internal view (what a PM sees) must be a superset of the supplier view.
    const internal = getAttributesForCategory(all, CAT);
    const supplier = getSupplierVisibleAttributes(all, CAT);
    expect(supplier.length).toBeLessThan(internal.length);
    for (const row of supplier) expect(internal).toContain(row);
    expect(internal.length - supplier.length).toBe(3);
  });

  it('returns nothing when every attribute is internal', () => {
    const allInternal = all.map(r => ({ ...r, supplierVisible: false }));
    expect(getSupplierVisibleAttributes(allInternal, CAT)).toEqual([]);
  });
});
