import { describe, it, expect } from 'vitest';
import { parseSkuCsv } from './sku-csv-import.utils';
import type { CategoryAttribute } from '../types';

const attrs: CategoryAttribute[] = [
  { id: 'a1', categoryId: 'c1', name: 'Defrost Type', dataType: 'enum', akeneoId: 'defrost_system_type', validationRules: { enumOptions: ['No Frost', 'Manual', 'Auto Defrost'] } },
  { id: 'a2', categoryId: 'c1', name: 'Nominal capacity', dataType: 'decimal', akeneoId: 'volume_capacity_name', validationRules: { unit: 'L' } },
  { id: 'a3', categoryId: 'c1', name: 'Interior lighting', dataType: 'boolean', akeneoId: 'interior_lighting' },
];

// Transposed sheet: attributes are ROWS, SKUs are COLUMNS. First column = attribute code/name,
// header row = SKU numbers, plus a Title row and an unmatched attribute row.
const CSV = [
  'Attribute,10027671,10027672,10027673',
  'Title,Cooler A,Cooler B,Cooler C',
  'defrost_system_type,No Frost,Manual,Bogus',
  'volume_capacity_name,120,9.5,notanumber',
  'Interior lighting,Yes,No,maybe',
  'random_extra,junk,junk2,',
].join('\n');

describe('parseSkuCsv (transposed)', () => {
  const res = parseSkuCsv(CSV, attrs);

  it('reads SKU numbers from the header row (columns)', () => {
    expect(res.skus.map(s => s.skuNumber)).toEqual(['10027671', '10027672', '10027673']);
    expect(res.rows.map(r => r.skuNumber)).toEqual(['10027671', '10027672', '10027673']);
  });

  it('applies the Title row to SKU titles', () => {
    expect(res.rows[0].skuTitle).toBe('Cooler A');
    expect(res.rows[1].skuTitle).toBe('Cooler B');
  });

  it('matches attribute rows by code and name, flags unmatched', () => {
    const matched = Object.fromEntries(res.attributes.map(a => [a.label, a.matched]));
    expect(matched['defrost_system_type']).toBe(true);
    expect(matched['volume_capacity_name']).toBe(true);
    expect(matched['Interior lighting']).toBe(true); // matched by name
    expect(matched['random_extra']).toBe(false);
  });

  it('builds per-SKU values and normalizes booleans', () => {
    const a = res.rows[0];
    expect(a.values.find(v => v.attributeId === 'a1')?.value).toBe('No Frost');
    expect(a.values.find(v => v.attributeId === 'a2')?.value).toBe('120');
    expect(a.values.find(v => v.attributeId === 'a3')?.value).toBe('true');
    expect(res.rows[1].values.find(v => v.attributeId === 'a3')?.value).toBe('false');
  });

  it('flags invalid enum, number and boolean cells against the right SKU', () => {
    const c = res.rows[2]; // 10027673
    expect(c.flags.some(f => /Defrost Type.*allowed options/i.test(f))).toBe(true);
    expect(c.flags.some(f => /Nominal capacity.*not a number/i.test(f))).toBe(true);
    expect(c.flags.some(f => /Interior lighting.*yes\/no/i.test(f))).toBe(true);
  });
});
