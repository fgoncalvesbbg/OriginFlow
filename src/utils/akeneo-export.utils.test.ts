import { describe, it, expect } from 'vitest';
import { akeneoColumnCode } from './akeneo-export.utils';
import type { CategoryAttribute } from '../types';

const attr = (o: Partial<CategoryAttribute> & { name: string }): CategoryAttribute => ({
  id: o.name,
  categoryId: 'c1',
  dataType: 'text',
  ...o,
});

// The row builder that used to be tested here was removed; exports are now built from the
// authoritative value store, and its behaviour is covered in
// components/products/attribute-grid/export-validation.utils.test.ts. What survives here is the
// column-code convention, which the export validator depends on.

describe('akeneoColumnCode', () => {
  it('uses the external code when the attribute has one', () => {
    expect(akeneoColumnCode(attr({ name: 'Defrost Type', akeneoId: 'defrost_system_type' })))
      .toBe('defrost_system_type');
  });

  it('falls back to a slug of the name', () => {
    expect(akeneoColumnCode(attr({ name: 'Special Note' }))).toBe('special_note');
  });

  it('trims and collapses punctuation in the slug', () => {
    expect(akeneoColumnCode(attr({ name: '  Airflow (m³/h) max  ' }))).toBe('airflow_m_h_max');
    expect(akeneoColumnCode(attr({ name: 'Box 1 - Content [what is inside?]' })))
      .toBe('box_1_content_what_is_inside');
  });

  it('prefers a code even when it looks nothing like the name', () => {
    expect(akeneoColumnCode(attr({ name: 'Energy class', akeneoId: 'eek_2021' }))).toBe('eek_2021');
  });

  it('ignores a whitespace-only code', () => {
    expect(akeneoColumnCode(attr({ name: 'Product Width', akeneoId: '   ' }))).toBe('product_width');
  });

  it('COLLIDES for two names that slug the same — which is why the export validates first', () => {
    // The name fallback is not injective. Two attributes landing on one column made the old
    // builder silently drop the second, so validateExport now refuses the export outright.
    expect(akeneoColumnCode(attr({ name: 'Product Width' })))
      .toBe(akeneoColumnCode(attr({ name: 'product   width' })));
  });

  it('COLLIDES for two attributes sharing an external code', () => {
    expect(akeneoColumnCode(attr({ name: 'Width A', akeneoId: 'width' })))
      .toBe(akeneoColumnCode(attr({ name: 'Width B', akeneoId: 'width' })));
  });
});
