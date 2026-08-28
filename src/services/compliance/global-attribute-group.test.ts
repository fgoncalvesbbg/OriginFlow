/**
 * Covers the 'Global' attribute group: attributes that belong to every category, sort to the
 * top of every list, and must be reused rather than re-created when a second category is
 * imported.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS, attributeGroupRank } from '../../config/compliance.constants';

interface FakeRow {
  id: string;
  category_id: string | null;
  assigned_category_ids: string[];
  name: string;
  data_type: string;
  validation_rules: unknown;
  group: string;
  akeneo_id: string | null;
}

const CAT_A = 'cat-angled-hoods';
const CAT_B = 'cat-beverage-coolers';

let rows: FakeRow[] = [];

vi.mock('../../data', () => ({
  orEmpty: async (p: Promise<unknown>) => p,
  portalDb: { select: async () => rows },
  db: {
    select: async (_t: string, opts?: any) =>
      rows.filter(r => !opts?.where?.akeneo_id || r.akeneo_id === opts.where.akeneo_id),
    selectOne: async (_t: string, opts?: any) => rows.find(r => r.id === opts?.where?.id) ?? null,
    upsert: async (_t: string, payload: any) => {
      const i = rows.findIndex(r => r.id === payload.id);
      if (i >= 0) rows[i] = { ...rows[i], ...payload };
      else rows.push(payload);
    },
    updateWhere: async (_t: string, patch: any, opts: any) => {
      const r = rows.find(x => x.id === opts?.where?.id);
      if (r) Object.assign(r, patch);
    },
    delete: async (_t: string, opts: any) => { rows = rows.filter(r => r.id !== opts?.where?.id); },
  },
}));
vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { importCategoryAttributes, replaceCategoryAttributes, getCategoryAttributes } from './compliance-requirement.service';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';

const ptRow = (over: Partial<ParsedAttributeRow> & { name: string }): ParsedAttributeRow => ({
  group: 'Global', dataType: 'text', flags: [], rawGroup: '', rawDataType: '', ...over,
});

beforeEach(() => { rows = []; });

describe("the 'Global' attribute group", () => {
  it('is a real group, treated as global, and sorts first', () => {
    expect(ATTRIBUTE_GROUPS).toContain('Global');
    expect(PREDEFINED_ATTRIBUTE_GROUPS).toContain('Global');
    expect(attributeGroupRank('Global')).toBe(0);
    expect(attributeGroupRank('Global')).toBeLessThan(attributeGroupRank('Category Specific'));
    expect(attributeGroupRank('Standard Electric Specs')).toBeLessThan(attributeGroupRank('Nonsense'));
  });

  it('imports as a global attribute, not scoped to the importing category', async () => {
    const res = await importCategoryAttributes(CAT_A, [ptRow({ name: 'SKU', akeneoId: 'sku' })]);
    expect(res.created).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].category_id).toBeNull(); // applies everywhere, not just CAT_A
    expect(rows[0].group).toBe('Global');
  });

  it('is not re-imported when a second category is imported', async () => {
    await importCategoryAttributes(CAT_A, [ptRow({ name: 'SKU', akeneoId: 'sku' })]);
    const second = await importCategoryAttributes(CAT_B, [ptRow({ name: 'SKU', akeneoId: 'sku' })]);

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);   // already applies here — nothing to do
    expect(rows).toHaveLength(1);     // no duplicate
    expect(rows[0].category_id).toBeNull();
  });

  it('is reused across categories even without an Akeneo code', async () => {
    // Falls back to name-within-group matching, so a code-less Global row still dedupes.
    await importCategoryAttributes(CAT_A, [ptRow({ name: 'Product Name' })]);
    const second = await importCategoryAttributes(CAT_B, [ptRow({ name: 'Product Name' })]);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('stays visible to every category', async () => {
    await importCategoryAttributes(CAT_A, [ptRow({ name: 'SKU', akeneoId: 'sku' })]);
    const all = await getCategoryAttributes();
    // getAttributesForCategory treats categoryId === null as applying everywhere.
    expect(all[0].categoryId).toBeNull();
  });

  it('survives a Replace run on any single category', async () => {
    await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'SKU', akeneoId: 'sku' }),
      ptRow({ name: 'Airflow max', akeneoId: 'max_airflow', group: 'Category Specific' }),
    ]);
    expect(rows).toHaveLength(2);

    const res = await replaceCategoryAttributes(CAT_A, []);
    expect(res.deleted).toBe(1); // only the category-scoped one
    const left = rows.map(r => r.name);
    expect(left).toEqual(['SKU']); // the Global attribute is untouched
  });

  it('reuses Battery and Packaging attributes on the next category import', async () => {
    // The reported case: import a category carrying global-group attributes, then import a
    // different category carrying the same ones. Nothing may be created the second time.
    const first = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'Number of batteries main unit', akeneoId: 'number_of_batteries', group: 'Battery Information' }),
      ptRow({ name: 'Type of batteries main unit', akeneoId: 'battery_type', group: 'Battery Information' }),
      ptRow({ name: 'ISTA Level', akeneoId: 'ista_level', group: 'Packaging' }),
      ptRow({ name: 'Airflow max', akeneoId: 'max_airflow', group: 'Category Specific' }),
    ]);
    expect(first.created).toBe(4);

    const second = await importCategoryAttributes(CAT_B, [
      ptRow({ name: 'Number of batteries main unit', akeneoId: 'number_of_batteries', group: 'Battery Information' }),
      ptRow({ name: 'Type of batteries main unit', akeneoId: 'battery_type', group: 'Battery Information' }),
      ptRow({ name: 'ISTA Level', akeneoId: 'ista_level', group: 'Packaging' }),
    ]);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);
    expect(rows.filter(r => r.group === 'Battery Information')).toHaveLength(2);
    expect(rows.filter(r => r.group === 'Packaging')).toHaveLength(1);
  });

  it('reuses a code-less existing global that the incoming row has a code for', async () => {
    // OriginFlow has code-less globals (all of Product Images). A code-only match would miss
    // them and duplicate; matching on name within the group first is what prevents that.
    rows.push({
      id: 'img-front', category_id: null, assigned_category_ids: [], name: 'Front',
      data_type: 'image', validation_rules: null, group: 'Product Images', akeneo_id: null,
    });
    const res = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'Front', akeneoId: 'image_front', group: 'Product Images' }),
    ]);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('reuses a renamed global via its Akeneo code', async () => {
    rows.push({
      id: 'pwr', category_id: null, assigned_category_ids: [], name: 'Power (W)',
      data_type: 'decimal', validation_rules: null, group: 'Standard Electric Specs', akeneo_id: 'total_power',
    });
    const res = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'Total power', akeneoId: 'total_power', group: 'Standard Electric Specs' }),
    ]);
    expect(res.created).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Power (W)'); // additive import never renames what is already there
  });

  it('collapses a global mentioned twice in the same file', async () => {
    const res = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'ISTA Level', akeneoId: 'ista_level', group: 'Packaging' }),
      ptRow({ name: 'ISTA Level', akeneoId: 'ista_level', group: 'Packaging' }),
    ]);
    expect(res.created).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('reports truthful counts when sibling rows share one Akeneo code', async () => {
    // An Akeneo code belongs to exactly one attribute — saveCategoryAttribute's
    // reuseExistingByAkeneoId refuses to write a second row carrying a code already taken.
    // The import used to count that unwritten row as "created", overstating the result;
    // it now resolves to the owning attribute, so the count matches what is on disk.
    const res = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'Box 1 - Content', akeneoId: 'package_contents', group: 'Category Specific' }),
      ptRow({ name: 'Box 2 - Content', akeneoId: 'package_contents', group: 'Category Specific' }),
    ]);
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
    expect(rows.map(r => r.name)).toEqual(['Box 1 - Content']);
    expect(res.created).toBe(rows.length); // the count is the reality
  });

  it('keeps distinct Category Specific rows that carry distinct codes', async () => {
    const res = await importCategoryAttributes(CAT_A, [
      ptRow({ name: 'Box 1 - Content', akeneoId: 'package_1_contents', group: 'Category Specific' }),
      ptRow({ name: 'Box 2 - Content', akeneoId: 'package_2_contents', group: 'Category Specific' }),
    ]);
    expect(res.created).toBe(2);
    expect(rows.map(r => r.name)).toEqual(['Box 1 - Content', 'Box 2 - Content']);
  });

  it('orders Global ahead of every other group', () => {
    const shuffled = ['Packaging', 'Category Specific', 'Global', 'Standard Electric Specs'];
    const sorted = [...shuffled].sort((a, b) => attributeGroupRank(a) - attributeGroupRank(b));
    expect(sorted[0]).toBe('Global');
  });
});
