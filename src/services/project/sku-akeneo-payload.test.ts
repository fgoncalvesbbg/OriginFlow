/**
 * Covers the outbound SKU payload: what ProductToolkit receives when it asks OriginFlow
 * what was captured for a SKU. Served by netlify/functions/sku-attributes.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSkuAttributePayload,
  indexAttributes,
  withLatestSubmission,
  type AttributeLookupRow,
  type SkuRow,
} from './sku-akeneo-payload';

const attr = (over: Partial<AttributeLookupRow> & { id: string }): AttributeLookupRow => ({
  akeneo_id: null, name: 'Attr', group: 'Category Specific', data_type: 'text', ...over,
});

const sku = (over: Partial<SkuRow> = {}): SkuRow => ({
  id: 'sku-1', sku_number: '10035001', sku_title: 'Angled hood 60cm',
  category_id: 'cat-angled-hoods', attribute_values: [], is_final: false,
  pending_export: true, last_exported_at: null, updated_at: '2026-08-28T10:00:00Z', ...over,
});

describe('buildSkuAttributePayload', () => {
  it('keys captured values by their Akeneo code', () => {
    const lookup = indexAttributes([
      attr({ id: 'a1', akeneo_id: 'motor_power_W', name: 'Motor Power' }),
      attr({ id: 'a2', akeneo_id: 'has_rgb_light', name: 'RGB' }),
    ]);
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [
        { attributeId: 'a1', name: 'Motor Power', value: '210' },
        { attributeId: 'a2', name: 'RGB', value: 'true' },
      ] }),
      lookup,
      'Angled Hoods',
    );
    expect(payload.attributes).toEqual({ motor_power_W: '210', has_rgb_light: 'true' });
    expect(payload.unmapped).toEqual([]);
    expect(payload.categoryName).toBe('Angled Hoods');
    expect(payload.skuNumber).toBe('10035001');
  });

  it('reports an attribute with no Akeneo code instead of dropping it silently', () => {
    const lookup = indexAttributes([attr({ id: 'a1', akeneo_id: null, name: 'Product Name' })]);
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [{ attributeId: 'a1', name: 'Product Name', value: 'Hood X' }] }),
      lookup,
    );
    expect(payload.attributes).toEqual({});
    expect(payload.unmapped).toEqual([
      { attributeId: 'a1', name: 'Product Name', reason: 'no-akeneo-code' },
    ]);
  });

  it('reports a value whose attribute no longer exists', () => {
    // Exactly what the category_attributes wipe produced: values pointing at dead ids.
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [{ attributeId: 'deleted-id', name: 'Airflow max', value: '620' }] }),
      indexAttributes([]),
    );
    expect(payload.attributes).toEqual({});
    expect(payload.unmapped).toEqual([
      { attributeId: 'deleted-id', name: 'Airflow max', reason: 'unknown-attribute' },
    ]);
  });

  it('omits blank values rather than emitting empty strings', () => {
    // An empty string would let a consumer overwrite good upstream data with nothing.
    const lookup = indexAttributes([
      attr({ id: 'a1', akeneo_id: 'motor_power_W' }),
      attr({ id: 'a2', akeneo_id: 'has_rgb_light' }),
    ]);
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [
        { attributeId: 'a1', value: '' },
        { attributeId: 'a2', value: '   ' },
      ] }),
      lookup,
    );
    expect(payload.attributes).toEqual({});
    expect(payload.unmapped).toEqual([]); // mappable, just not captured
  });

  it('trims values', () => {
    const lookup = indexAttributes([attr({ id: 'a1', akeneo_id: 'duct_outlet' })]);
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [{ attributeId: 'a1', value: '  150 mm  ' }] }),
      lookup,
    );
    expect(payload.attributes).toEqual({ duct_outlet: '150 mm' });
  });

  it('carries the export-tracking fields through', () => {
    const payload = buildSkuAttributePayload(
      sku({ is_final: true, pending_export: false, last_exported_at: '2026-08-01T00:00:00Z' }),
      indexAttributes([]),
    );
    expect(payload.isFinal).toBe(true);
    expect(payload.pendingExport).toBe(false);
    expect(payload.lastExportedAt).toBe('2026-08-01T00:00:00Z');
  });

  it('handles a SKU with no captured values at all', () => {
    const payload = buildSkuAttributePayload(sku({ attribute_values: null }), indexAttributes([]));
    expect(payload.attributes).toEqual({});
    expect(payload.unmapped).toEqual([]);
  });

  it('ignores malformed entries without an attributeId', () => {
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [{ attributeId: '', value: 'x' } as any, null as any] }),
      indexAttributes([]),
    );
    expect(payload.attributes).toEqual({});
    expect(payload.unmapped).toEqual([]);
  });

  it('lets the last non-empty entry win when two resolve to one code', () => {
    const lookup = indexAttributes([
      attr({ id: 'a1', akeneo_id: 'main_color' }),
      attr({ id: 'a2', akeneo_id: 'main_color' }),
    ]);
    const payload = buildSkuAttributePayload(
      sku({ attribute_values: [
        { attributeId: 'a1', value: 'Black' },
        { attributeId: 'a2', value: 'Silver' },
      ] }),
      lookup,
    );
    expect(payload.attributes).toEqual({ main_color: 'Silver' });
  });
});

describe('withLatestSubmission', () => {
  it('lets a submitted value win over the SKU\'s own stored value for the same attribute', () => {
    const lookup = indexAttributes([attr({ id: 'a1', akeneo_id: 'main_color' })]);
    const merged = withLatestSubmission(
      [{ attributeId: 'a1', value: 'Black' }],
      [{ attributeId: 'a1', value: 'Silver' }],
    );
    const payload = buildSkuAttributePayload(sku({ attribute_values: merged }), lookup);
    expect(payload.attributes).toEqual({ main_color: 'Silver' });
  });

  it('falls back to the SKU\'s own value when the submission leaves an attribute blank', () => {
    // Mirrors getEffectiveSkuValue: a blank submitted value must not clear a good stored one.
    const lookup = indexAttributes([attr({ id: 'a1', akeneo_id: 'main_color' })]);
    const merged = withLatestSubmission(
      [{ attributeId: 'a1', value: 'Black' }],
      [{ attributeId: 'a1', value: '' }],
    );
    const payload = buildSkuAttributePayload(sku({ attribute_values: merged }), lookup);
    expect(payload.attributes).toEqual({ main_color: 'Black' });
  });

  it('adds a submitted attribute the SKU never had its own value for', () => {
    const lookup = indexAttributes([attr({ id: 'a1', akeneo_id: 'zone_1_size' })]);
    const merged = withLatestSubmission([], [{ attributeId: 'a1', value: '14' }]);
    const payload = buildSkuAttributePayload(sku({ attribute_values: merged }), lookup);
    expect(payload.attributes).toEqual({ zone_1_size: '14' });
  });

  it('handles no submission and no stored values', () => {
    expect(withLatestSubmission(null, null)).toEqual([]);
    expect(withLatestSubmission(undefined, undefined)).toEqual([]);
  });
});
