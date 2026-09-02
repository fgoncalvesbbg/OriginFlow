/**
 * Covers replaceCategoryAttributes — the destructive "upstream is the truth" import.
 *
 * The fixture mirrors the real shape of the Angled Hoods case: a couple of attributes owned
 * by the category, one owned by a sibling category but shared in, and globals from the
 * predefined groups that must survive untouched because every category depends on them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const ANGLED = 'cat-angled-hoods';
const BEVERAGE = 'cat-beverage-coolers';

let rows: FakeRow[] = [];

const row = (over: Partial<FakeRow> & { id: string; name: string }): FakeRow => ({
  category_id: null, assigned_category_ids: [], data_type: 'text',
  validation_rules: null, group: 'Category Specific', akeneo_id: null, ...over,
});

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
    delete: async (_t: string, opts: any) => {
      rows = rows.filter(r => r.id !== opts?.where?.id);
    },
  },
}));
vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { replaceCategoryAttributes, getCategoryAttributes } from './compliance-requirement.service';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';

const ptRow = (over: Partial<ParsedAttributeRow> & { name: string }): ParsedAttributeRow => ({
  group: 'Category Specific', dataType: 'text', flags: [], rawGroup: '', rawDataType: '', ...over,
});

beforeEach(() => {
  rows = [
    // Owned by Angled Hoods — the "wrong" attributes to be replaced.
    row({ id: 'own-1', name: 'Carbon Filters Included?', category_id: ANGLED }),
    row({ id: 'own-2', name: 'SKU', category_id: ANGLED }),
    // Owned by a sibling, shared into Angled Hoods.
    row({ id: 'shared-1', name: 'Defrost Type', category_id: BEVERAGE, assigned_category_ids: [ANGLED], akeneo_id: 'defrost_system_type' }),
    // Global — applies to every category.
    row({ id: 'glob-1', name: 'Power', group: 'Standard Electric Specs', akeneo_id: 'total_power' }),
  ];
});

describe('replaceCategoryAttributes', () => {
  it('deletes the category\'s own attributes and reports them', async () => {
    const res = await replaceCategoryAttributes(ANGLED, [ptRow({ name: 'Extraction rate', akeneoId: 'extraction_rate_max' })]);
    expect(res.deleted).toBe(2);
    expect(res.removed.map(r => r.name).sort()).toEqual(['Carbon Filters Included?', 'SKU']);
    expect(rows.find(r => r.id === 'own-1')).toBeUndefined();
    expect(rows.find(r => r.id === 'own-2')).toBeUndefined();
  });

  it('un-shares a sibling-owned attribute instead of deleting it', async () => {
    const res = await replaceCategoryAttributes(ANGLED, []);
    expect(res.unshared).toBe(1);
    const shared = rows.find(r => r.id === 'shared-1');
    expect(shared).toBeDefined();                              // still owned by Beverage Coolers
    expect(shared!.assigned_category_ids).not.toContain(ANGLED);
  });

  it('never touches a global attribute', async () => {
    await replaceCategoryAttributes(ANGLED, []);
    const glob = rows.find(r => r.id === 'glob-1');
    expect(glob).toBeDefined();
    expect(glob!.category_id).toBeNull();
  });

  it('leaves another category\'s attributes alone', async () => {
    rows.push(row({ id: 'other-1', name: 'No. of Bottles', category_id: BEVERAGE }));
    await replaceCategoryAttributes(ANGLED, []);
    expect(rows.find(r => r.id === 'other-1')).toBeDefined();
  });

  it('imports the incoming rows after clearing', async () => {
    const res = await replaceCategoryAttributes(ANGLED, [
      ptRow({ name: 'Extraction rate', akeneoId: 'extraction_rate_max' }),
      ptRow({ name: 'Filter type', akeneoId: 'filter_type', dataType: 'enum', enumOptions: ['Grease'] }),
    ]);
    expect(res.created).toBe(2);
    const after = (await getCategoryAttributes()).filter(a => a.categoryId === ANGLED);
    expect(after.map(a => a.name).sort()).toEqual(['Extraction rate', 'Filter type']);
  });

  it('re-links an incoming row that matches a global, rather than duplicating it', async () => {
    const res = await replaceCategoryAttributes(ANGLED, [
      ptRow({ name: 'Power', akeneoId: 'total_power', group: 'Standard Electric Specs' }),
    ]);
    expect(res.created).toBe(0);
    expect(res.skipped).toBe(1); // the global already applies here
    expect(rows.filter(r => r.akeneo_id === 'total_power')).toHaveLength(1);
  });

  it('keeps a sibling-owned attribute shared in, without churning it', async () => {
    // Replace now matches first, so an attribute this definition still lists is never
    // un-shared and re-linked. It stays owned by Beverage Coolers, stays shared into Angled
    // Hoods, and — critically — its ownership is NOT moved to the importing category.
    const res = await replaceCategoryAttributes(ANGLED, [
      ptRow({ name: 'Defrost Type', akeneoId: 'defrost_system_type' }),
    ]);
    expect(res.unshared).toBe(0);
    expect(res.created).toBe(0);
    const shared = rows.find(r => r.id === 'shared-1')!;
    expect(shared.category_id).toBe(BEVERAGE);          // owner unchanged
    expect(shared.assigned_category_ids).toContain(ANGLED);
  });

  it('empties a category when the source has nothing for it', async () => {
    const res = await replaceCategoryAttributes(ANGLED, []);
    expect(res.deleted).toBe(2);
    expect(res.created).toBe(0);
    const after = (await getCategoryAttributes()).filter(
      a => a.categoryId === ANGLED || (a.assignedCategoryIds ?? []).includes(ANGLED),
    );
    expect(after).toHaveLength(0);
  });
});
