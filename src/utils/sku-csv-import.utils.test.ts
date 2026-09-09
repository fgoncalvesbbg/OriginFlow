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

// Wide sheet, exactly as a category review export is laid out: a SECTION row above the header,
// then one row per SKU, with "— in Akeneo"/"— in EPREL" mirror columns beside each attribute.
const WIDE = [
  ',,,1 . Category Specific Attributes,,,2. Standard Specs,',
  'SKU,Description,Brand,Defrost Type,Defrost Type — in Akeneo,Nominal capacity,Nominal capacity — in EPREL,Interior lighting,random_extra',
  '10027671,Cooler A,Klarstein,No Frost,SHOULD_BE_IGNORED,120,999,Yes,junk',
  '10027672,Cooler B,Klarstein,Manual,,9.5,,No,junk2',
  '10027673,Cooler C,,Bogus,,notanumber,,maybe,',
].join('\n');

describe('parseSkuCsv (wide — one row per SKU)', () => {
  const res = parseSkuCsv(WIDE, attrs);

  it('detects the orientation without being told', () => {
    expect(res.orientation).toBe('wide');
    expect(res.orientationForced).toBe(false);
  });

  it('skips the section row above the header and reads SKUs down the side', () => {
    expect(res.rows.map(r => r.skuNumber)).toEqual(['10027671', '10027672', '10027673']);
    expect(res.skus.map(s => s.skuNumber)).toEqual(['10027671', '10027672', '10027673']);
  });

  it('takes the Description column as the SKU title', () => {
    expect(res.rows.map(r => r.skuTitle)).toEqual(['Cooler A', 'Cooler B', 'Cooler C']);
  });

  it('matches attribute columns and reports the ones it cannot', () => {
    const matched = Object.fromEntries(res.attributes.map(a => [a.label, a.matched]));
    expect(matched['Defrost Type']).toBe(true);
    expect(matched['Nominal capacity']).toBe(true);
    expect(matched['Interior lighting']).toBe(true);
    expect(matched['random_extra']).toBe(false);
    // "Brand" is a real column that this category simply has no attribute for.
    expect(matched['Brand']).toBe(false);
  });

  it('ignores the Akeneo/EPREL mirror columns instead of importing them', () => {
    expect(res.ignoredColumns).toEqual([
      'Defrost Type — in Akeneo',
      'Nominal capacity — in EPREL',
    ]);
    // The mirror is neither matched as an attribute nor written as a value.
    expect(res.attributes.some(a => /in Akeneo/.test(a.label))).toBe(false);
    expect(
      res.rows[0].values.some(v => v.value === 'SHOULD_BE_IGNORED' || v.value === '999'),
    ).toBe(false);
  });

  it('coerces and flags cells the same way the transposed reader does', () => {
    expect(res.rows[0].values.find(v => v.attributeId === 'a1')?.value).toBe('No Frost');
    expect(res.rows[0].values.find(v => v.attributeId === 'a2')?.value).toBe('120');
    expect(res.rows[0].values.find(v => v.attributeId === 'a3')?.value).toBe('true');
    expect(res.rows[1].values.find(v => v.attributeId === 'a3')?.value).toBe('false');

    const c = res.rows[2];
    expect(c.flags.some(f => /Defrost Type.*allowed options/i.test(f))).toBe(true);
    expect(c.flags.some(f => /Nominal capacity.*not a number/i.test(f))).toBe(true);
    expect(c.flags.some(f => /Interior lighting.*yes\/no/i.test(f))).toBe(true);
  });

  it('leaves blank cells out entirely rather than writing an empty value', () => {
    // 10027673 has no Brand and no random_extra; neither is an attribute anyway, and its
    // Description is present, so only the three real attributes come through.
    expect(res.rows[2].values).toHaveLength(3);
  });
});

describe('parseSkuCsv orientation control', () => {
  it('reads a transposed sheet as transposed', () => {
    expect(parseSkuCsv(CSV, attrs).orientation).toBe('transposed');
  });

  it('honours a forced orientation over its own guess', () => {
    const forced = parseSkuCsv(WIDE, attrs, { orientation: 'transposed' });
    expect(forced.orientation).toBe('transposed');
    expect(forced.orientationForced).toBe(true);
    // Read the wrong way round, the SKU numbers are gone — which is exactly why the preview
    // states the orientation and offers the switch.
    expect(forced.rows.map(r => r.skuNumber)).not.toContain('10027671');
  });

  it('matches an attribute whose name differs only in punctuation or a superscript', () => {
    const punctuated: CategoryAttribute[] = [
      { id: 'p1', categoryId: 'c1', name: 'Grease Filter dishwasher safe', dataType: 'boolean' },
      { id: 'p2', categoryId: 'c1', name: 'Airflow (m³/h) max', dataType: 'integer' },
    ];
    const res = parseSkuCsv(
      ['SKU,Grease Filter dishwasher safe?,Airflow (m3/h) max', '10030822,Yes,780'].join('\n'),
      punctuated,
    );
    expect(res.rows[0].values.find(v => v.attributeId === 'p1')?.value).toBe('true');
    expect(res.rows[0].values.find(v => v.attributeId === 'p2')?.value).toBe('780');
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
