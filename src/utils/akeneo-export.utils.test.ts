import { describe, it, expect } from 'vitest';
import { buildAkeneoRows, akeneoColumnCode } from './akeneo-export.utils';
import type { CategoryAttribute, ProjectSku } from '../types';

const attrs: CategoryAttribute[] = [
  { id: 'a1', categoryId: 'c1', name: 'Defrost Type', dataType: 'enum', akeneoId: 'defrost_system_type' },
  { id: 'a2', categoryId: 'c1', name: 'Nominal capacity', dataType: 'decimal', akeneoId: 'volume_capacity_name' },
  { id: 'a3', categoryId: 'c1', name: 'Interior lighting', dataType: 'boolean', akeneoId: 'interior_lighting' },
  { id: 'a4', categoryId: 'c1', name: 'Special Note', dataType: 'text' }, // no akeneo code → slug
];

const sku = (over: Partial<ProjectSku>): ProjectSku => ({
  id: 'x', projectId: null, skuNumber: '', skuTitle: '', attributeValues: [],
  sortOrder: 0, isFinal: false, pendingExport: true, lastExportedAt: null,
  createdAt: '', updatedAt: '', ...over,
});

describe('buildAkeneoRows', () => {
  it('uses Akeneo code, falling back to a name slug', () => {
    expect(akeneoColumnCode(attrs[0])).toBe('defrost_system_type');
    expect(akeneoColumnCode(attrs[3])).toBe('special_note');
  });

  it('emits sku + sku_title then one column per attribute code', () => {
    const { headers } = buildAkeneoRows([], attrs);
    expect(headers).toEqual(['sku', 'sku_title', 'defrost_system_type', 'volume_capacity_name', 'interior_lighting', 'special_note']);
  });

  it('maps values by attribute id and formats booleans as 1/0', () => {
    const { rows } = buildAkeneoRows([
      sku({ skuNumber: '10027671', skuTitle: 'Cooler A', attributeValues: [
        { attributeId: 'a1', name: 'Defrost Type', value: 'No Frost' },
        { attributeId: 'a2', name: 'Nominal capacity', value: '120' },
        { attributeId: 'a3', name: 'Interior lighting', value: 'true' },
      ] }),
    ], attrs);
    expect(rows[0]).toEqual({
      sku: '10027671', sku_title: 'Cooler A',
      defrost_system_type: 'No Frost', volume_capacity_name: '120',
      interior_lighting: '1', special_note: '',
    });
  });
});
