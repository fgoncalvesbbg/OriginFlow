import { describe, it, expect } from 'vitest';
import { getEffectiveSkuValue, collapseSkuAttributeValues } from './project-sku.service';
import { SKU_ATTRIBUTE_ID } from '../../config/compliance.constants';
import type { ProjectSku, ProjectAttributeRequest } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSku = (overrides: Partial<ProjectSku> & { id: string; skuNumber: string }): ProjectSku => ({
  projectId: 'proj-1',
  skuTitle: '',
  attributeValues: [],
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeRequest = (
  overrides: Partial<ProjectAttributeRequest> & { skuNumber: string },
): ProjectAttributeRequest => ({
  id: `req-${overrides.skuNumber}`,
  projectId: 'proj-1',
  projectIdCode: 'P1',
  categoryId: 'cat-1',
  projectName: 'Proj',
  categoryName: 'Cat',
  token: 'tok',
  step: 2,
  skuTitle: '',
  status: 'submitted',
  submittedData: [],
  createdAt: '2026-01-01T00:00:00Z',
  submittedAt: '2026-01-02T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// getEffectiveSkuValue
// ---------------------------------------------------------------------------

describe('getEffectiveSkuValue', () => {
  it('prefers the latest supplier submission over the SKU stored value', () => {
    const sku = makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] });
    const reqs = [makeRequest({ skuNumber: 'A', submittedData: [{ attributeId: 'color', name: 'Color', value: 'Blue' }] })];
    expect(getEffectiveSkuValue(sku, reqs, 'color')).toBe('Blue');
  });

  it('falls back to the SKU stored value when no submission exists', () => {
    const sku = makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] });
    expect(getEffectiveSkuValue(sku, [], 'color')).toBe('Red');
  });

  it('uses the newest submission when several exist for the same SKU', () => {
    const sku = makeSku({ id: 's1', skuNumber: 'A' });
    const reqs = [
      makeRequest({ skuNumber: 'A', submittedAt: '2026-01-02T00:00:00Z', submittedData: [{ attributeId: 'color', name: 'Color', value: 'Old' }] }),
      makeRequest({ skuNumber: 'A', submittedAt: '2026-03-01T00:00:00Z', submittedData: [{ attributeId: 'color', name: 'Color', value: 'New' }] }),
    ];
    expect(getEffectiveSkuValue(sku, reqs, 'color')).toBe('New');
  });

  it('returns empty string when neither source has a value', () => {
    expect(getEffectiveSkuValue(makeSku({ id: 's1', skuNumber: 'A' }), [], 'color')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// collapseSkuAttributeValues
// ---------------------------------------------------------------------------

describe('collapseSkuAttributeValues', () => {
  it('returns {} for an empty SKU list', () => {
    expect(collapseSkuAttributeValues([], [])).toEqual({});
  });

  it('shows a single value when all SKUs agree', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'volt', name: 'Voltage', value: '230V' }] }),
      makeSku({ id: 's2', skuNumber: 'B', attributeValues: [{ attributeId: 'volt', name: 'Voltage', value: '230V' }] }),
    ];
    expect(collapseSkuAttributeValues(skus, [])['volt']).toBe('230V');
  });

  it('joins distinct values with ", " when SKUs differ (deduped)', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] }),
      makeSku({ id: 's2', skuNumber: 'B', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] }),
      makeSku({ id: 's3', skuNumber: 'C', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Blue' }] }),
    ];
    expect(collapseSkuAttributeValues(skus, [])['color']).toBe('Red, Blue');
  });

  it('resolves the SKU identifier to all SKU numbers joined by ", "', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A-100' }),
      makeSku({ id: 's2', skuNumber: 'A-200' }),
    ];
    expect(collapseSkuAttributeValues(skus, [])[SKU_ATTRIBUTE_ID]).toBe('A-100, A-200');
  });

  it('uses the first non-empty value for image attributes instead of joining', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'img', name: 'Front', value: 'url-a' }] }),
      makeSku({ id: 's2', skuNumber: 'B', attributeValues: [{ attributeId: 'img', name: 'Front', value: 'url-b' }] }),
    ];
    const out = collapseSkuAttributeValues(skus, [], new Set(['img']));
    expect(out['img']).toBe('url-a');
  });

  it('overlays supplier submissions on stored values before collapsing', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] }),
      makeSku({ id: 's2', skuNumber: 'B', attributeValues: [{ attributeId: 'color', name: 'Color', value: 'Red' }] }),
    ];
    const reqs = [makeRequest({ skuNumber: 'B', submittedData: [{ attributeId: 'color', name: 'Color', value: 'Green' }] })];
    expect(collapseSkuAttributeValues(skus, reqs)['color']).toBe('Red, Green');
  });

  it('drops empty values so an all-empty attribute collapses to ""', () => {
    const skus = [
      makeSku({ id: 's1', skuNumber: 'A', attributeValues: [{ attributeId: 'note', name: 'Note', value: '' }] }),
      makeSku({ id: 's2', skuNumber: 'B', attributeValues: [{ attributeId: 'note', name: 'Note', value: '' }] }),
    ];
    expect(collapseSkuAttributeValues(skus, [])['note']).toBe('');
  });
});
