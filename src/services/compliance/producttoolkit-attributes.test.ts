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

  it('strips the cluster numbering and lands on a canonical group', () => {
    // "2. Standard Electric Specs" is a predefined group, so the import will create this
    // attribute as GLOBAL rather than scoping it to the category.
    expect(mapProductToolkitAttributes([attr()])[0].group).toBe('Standard Electric Specs');
    expect(mapProductToolkitAttributes([attr({ cluster: '9. Accessories' })])[0].group).toBe('Accessories');
  });

  it("routes a cluster named Global into the Global group", () => {
    // Nothing special-cases it: 'Global' is a canonical group name, so the shared
    // mapGroupName picks it up like any other, numbering stripped.
    for (const cluster of ['Global', '1. Global', ' global ']) {
      const [row] = mapProductToolkitAttributes([attr({ cluster })]);
      expect(row.group).toBe('Global');
      expect(row.flags).toEqual([]);
    }
  });

  it('falls back to Category Specific and flags an unknown cluster', () => {
    const [row] = mapProductToolkitAttributes([attr({ cluster: '1. General' })]);
    expect(row.group).toBe('Category Specific');
    expect(row.flags.join(' ')).toMatch(/no matching group/i);
    expect(row.rawGroup).toBe('1. General');
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
