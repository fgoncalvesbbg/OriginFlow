import { describe, it, expect } from 'vitest';
import { parseSkuCsv, parseSkuRoster } from './sku-csv-import.utils';
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

describe('parseSkuRoster', () => {
  it('takes bare SKU numbers, one per line', () => {
    const res = parseSkuRoster('10045678\n10045679\n10045680');
    expect(res.rows.map(r => r.skuNumber)).toEqual(['10045678', '10045679', '10045680']);
    expect(res.rows.every(r => r.values.length === 0)).toBe(true);
    expect(res.skipped).toBe(0);
  });

  it('reads an optional title after a comma, semicolon or tab', () => {
    const res = parseSkuRoster('10045678, Cooler 34L Black\n10045679;Cooler 50L\n10045680\tCooler 80L');
    expect(res.rows.map(r => r.skuTitle)).toEqual(['Cooler 34L Black', 'Cooler 50L', 'Cooler 80L']);
  });

  it('keeps commas inside the title', () => {
    const res = parseSkuRoster('10045678, Cooler, 34L, Black');
    expect(res.rows[0].skuTitle).toBe('Cooler, 34L, Black');
  });

  it('collapses duplicates and backfills a missing title from a later line', () => {
    const res = parseSkuRoster('10045678\n10045678, Cooler 34L');
    expect(res.rows).toHaveLength(1);
    expect(res.duplicates).toBe(1);
    expect(res.rows[0].skuTitle).toBe('Cooler 34L');
  });

  it('skips blank lines and a pasted header row rather than importing them as SKUs', () => {
    const res = parseSkuRoster('SKU\n\n10045678\n   \n10045679');
    expect(res.rows.map(r => r.skuNumber)).toEqual(['10045678', '10045679']);
    expect(res.skipped).toBe(1); // the header; blank lines are not "skipped rows"
  });
});
