/**
 * Covers the pure half of the ProductToolkit importer: the mapping from a curated definition
 * to the preview rows importCategoryAttributes consumes. The network half needs the internal
 * network and is deliberately not exercised here.
 */
import { describe, it, expect } from 'vitest';
import { mapProductToolkitAttributes, type PtAttribute } from './producttoolkit-attributes.service';

const attr = (over: Partial<PtAttribute> = {}): PtAttribute => ({
  akeneoCode: 'power_watts',
  displayName: 'Power',
  fieldType: 'decimal',
  cluster: '2. Standard Electric Specs',
  options: [],
  eprelId: null,
  required: true,
  sortOrder: 4,
  ...over,
});

describe('mapProductToolkitAttributes', () => {
  it('maps a documented attribute onto app concepts', () => {
    const [row] = mapProductToolkitAttributes([attr()]);
    expect(row.name).toBe('Power');
    expect(row.akeneoId).toBe('power_watts');
    expect(row.dataType).toBe('decimal');
    expect(row.required).toBe(true);
    expect(row.flags).toEqual([]);
  });

  it('uses the ProductToolkit cluster verbatim as the group', () => {
    // PT owns the taxonomy. Translating its clusters onto OriginFlow's own ATTRIBUTE_GROUPS
    // was only a way to get it wrong: three of the six real cluster names had no match and
    // collapsed into 'Category Specific', taking 19 attributes and their scope with them.
    expect(mapProductToolkitAttributes([attr()])[0].group).toBe('2. Standard Electric Specs');
    expect(mapProductToolkitAttributes([attr({ cluster: '9. Accessories' })])[0].group).toBe('9. Accessories');
  });

  it('keeps the real cluster names intact, however awkward', () => {
    // Verified against the live definition — these are the actual strings.
    for (const cluster of [
      'Category 5.0 & Segmentation',
      '1 . Category Specific Attributes',
      '4. Battery Information - Mandatory for all items with batteries according to EU regulations',
      '5. Packaging & What is included',
    ]) {
      const [row] = mapProductToolkitAttributes([attr({ cluster })]);
      expect(row.group).toBe(cluster);
      expect(row.flags).toEqual([]); // nothing to flag: there is no mapping left to fail
    }
  });

  it('falls back to Category Specific only when the cluster is blank', () => {
    expect(mapProductToolkitAttributes([attr({ cluster: '' })])[0].group).toBe('Category Specific');
    expect(mapProductToolkitAttributes([attr({ cluster: '   ' })])[0].group).toBe('Category Specific');
  });

  it('carries the identity and scope fields the sync depends on', () => {
    const [row] = mapProductToolkitAttributes([attr({
      attributeId: 28, scope: 'global', supplierVisible: false, sortOrder: 12,
      unit: 'mm', eprelId: 'EP-1', usedByCategories: 3,
    })]);
    expect(row.ptAttributeId).toBe(28);
    expect(row.scope).toBe('global');
    expect(row.supplierVisible).toBe(false);
    expect(row.sortOrder).toBe(12);
    expect(row.unit).toBe('mm');
    expect(row.eprelId).toBe('EP-1');
    expect(row.usedByCategories).toBe(3);
  });

  it('ignores a scope value it does not understand rather than trusting it', () => {
    const [row] = mapProductToolkitAttributes([attr({ scope: 'something-new' as any })]);
    expect(row.scope).toBeUndefined(); // falls back to inferring from the group
  });

  it('maps both select kinds to enum, keeping the options', () => {
    const [single] = mapProductToolkitAttributes([
      attr({ fieldType: 'select', options: ['A', 'B'] }),
    ]);
    expect(single.dataType).toBe('enum');
    expect(single.enumOptions).toEqual(['A', 'B']);
    expect(single.flags).toEqual([]);

    const [multi] = mapProductToolkitAttributes([
      attr({ fieldType: 'multiselect', options: ['A'] }),
    ]);
    expect(multi.dataType).toBe('enum');
    expect(multi.flags.join(' ')).toMatch(/multi-select/i);
  });

  it('flags a select with no curated option list rather than treating it as closed', () => {
    const [row] = mapProductToolkitAttributes([attr({ fieldType: 'select', options: [] })]);
    expect(row.enumOptions).toEqual([]);
    expect(row.flags.join(' ')).toMatch(/Akeneo's own option list/i);
  });

  it('defaults an unrecognised field type to text and says so', () => {
    const [row] = mapProductToolkitAttributes([attr({ fieldType: 'metric' })]);
    expect(row.dataType).toBe('text');
    expect(row.flags.join(' ')).toMatch(/Unrecognised field type "metric"/);
  });

  it('falls back to the Akeneo code when there is no display name', () => {
    const [row] = mapProductToolkitAttributes([attr({ displayName: '  ' })]);
    expect(row.name).toBe('power_watts');
    expect(row.flags.join(' ')).toMatch(/No display name/i);
  });

  it('leaves required unset when the definition does not mark it', () => {
    expect(mapProductToolkitAttributes([attr({ required: false })])[0].required).toBeUndefined();
  });

  it('carries no enum options for a non-enum row', () => {
    expect(mapProductToolkitAttributes([attr({ options: ['stray'] })])[0].enumOptions).toBeUndefined();
  });
});
