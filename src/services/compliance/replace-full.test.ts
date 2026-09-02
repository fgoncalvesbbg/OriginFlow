/**
 * Covers Replace: "the category ends up with exactly the imported attributes, and nothing
 * that is still in the definition loses its identity on the way".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface R {
  id: string; category_id: string | null; assigned_category_ids: string[]; name: string;
  data_type: string; validation_rules: unknown; group: string; akeneo_id: string | null;
  supplier_visible?: boolean; sort_order?: number; pt_attribute_id?: number | null; eprel_id?: string | null;
}
let rows: R[] = [];

vi.mock('../../data', () => ({
  orEmpty: async (p: Promise<unknown>) => p,
  portalDb: { select: async () => rows },
  db: {
    select: async (_t: string, o?: any) => rows.filter(r => !o?.where?.akeneo_id || r.akeneo_id === o.where.akeneo_id),
    selectOne: async (_t: string, o?: any) => rows.find(r => r.id === o?.where?.id) ?? null,
    upsert: async (_t: string, p: any) => { const i = rows.findIndex(r => r.id === p.id); if (i >= 0) rows[i] = { ...rows[i], ...p }; else rows.push(p); },
    updateWhere: async (_t: string, patch: any, o: any) => { const r = rows.find(x => x.id === o?.where?.id); if (r) Object.assign(r, patch); },
    delete: async (_t: string, o: any) => { rows = rows.filter(r => r.id !== o?.where?.id); },
  },
}));
vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { replaceCategoryAttributes } from './compliance-requirement.service';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';

const CAT = 'cat-a';
const OTHER = 'cat-b';
const CS = '1 . Category Specific Attributes';

const row = (o: Partial<R> & { id: string; name: string }): R => ({
  category_id: CAT, assigned_category_ids: [], data_type: 'text', validation_rules: null,
  group: CS, akeneo_id: null, ...o,
});
const inc = (o: Partial<ParsedAttributeRow> & { name: string }): ParsedAttributeRow => ({
  group: CS, dataType: 'text', flags: [], rawGroup: '', rawDataType: '', scope: 'category', sortOrder: 5, ...o,
});

beforeEach(() => {
  rows = [
    row({ id: 'keep', name: 'Motor Power', akeneo_id: 'motor_power_W' }),
    row({ id: 'trash', name: 'Old leftover', akeneo_id: 'legacy_code' }),
    row({ id: 'glob-pt', name: 'Main Color', akeneo_id: 'main_color', category_id: null, group: 'Global' }),
    row({ id: 'glob-own', name: 'Product Image', akeneo_id: null, category_id: null, group: 'Product Images' }),
    row({ id: 'sibling', name: 'Shared in', akeneo_id: 'shared_code', category_id: OTHER, assigned_category_ids: [CAT] }),
  ];
});

const importOf = [inc({ name: 'Motor Power', akeneoId: 'motor_power_W' })];

describe('replaceCategoryAttributes', () => {
  it('keeps the id of anything still in the definition', async () => {
    const res = await replaceCategoryAttributes(CAT, importOf);
    expect(rows.find(r => r.akeneo_id === 'motor_power_W')!.id).toBe('keep');
    expect(res.updated).toBe(1);
    expect(res.created).toBe(0);
  });

  it("deletes this category's leftovers", async () => {
    const res = await replaceCategoryAttributes(CAT, importOf);
    expect(rows.find(r => r.id === 'trash')).toBeUndefined();
    expect(res.deleted).toBe(1);
    expect(res.removed.map(r => r.name)).toContain('Old leftover');
  });

  it('un-shares a sibling-owned attribute instead of deleting it', async () => {
    const res = await replaceCategoryAttributes(CAT, importOf);
    const sib = rows.find(r => r.id === 'sibling')!;
    expect(sib).toBeDefined();                       // still owned by the other category
    expect(sib.assigned_category_ids).not.toContain(CAT);
    expect(res.unshared).toBe(1);
  });

  it('leaves globals alone by default', async () => {
    const res = await replaceCategoryAttributes(CAT, importOf);
    expect(rows.find(r => r.id === 'glob-pt')).toBeDefined();
    expect(rows.find(r => r.id === 'glob-own')).toBeDefined();
    expect(res.deletedGlobals).toBe(0);
  });

  it('deletes globals too when explicitly asked, leaving exactly the imported set', async () => {
    const res = await replaceCategoryAttributes(CAT, importOf, { includeGlobals: true });
    expect(res.deletedGlobals).toBe(2);
    expect(rows.find(r => r.id === 'glob-pt')).toBeUndefined();
    expect(rows.find(r => r.id === 'glob-own')).toBeUndefined();
    // Exactly the import remains for this category (the sibling still exists, un-shared).
    expect(rows.filter(r => r.category_id === CAT).map(r => r.name)).toEqual(['Motor Power']);
    expect(res.removed.filter(r => r.wasGlobal).map(r => r.name).sort())
      .toEqual(['Main Color', 'Product Image']);
  });

  it('never deletes a global that IS in the definition, even with includeGlobals', async () => {
    // It is matched, so it is kept and updated in place — its id must survive.
    const res = await replaceCategoryAttributes(
      CAT,
      [inc({ name: 'Main Color', akeneoId: 'main_color', group: 'Global', scope: 'global' })],
      { includeGlobals: true },
    );
    const kept = rows.find(r => r.akeneo_id === 'main_color');
    expect(kept).toBeDefined();
    expect(kept!.id).toBe('glob-pt');
    expect(res.removed.map(r => r.name)).not.toContain('Main Color');
  });

  it('creates an attribute the definition adds', async () => {
    const res = await replaceCategoryAttributes(CAT, [
      ...importOf,
      inc({ name: 'Brand new', akeneoId: 'brand_new' }),
    ]);
    expect(res.created).toBe(1);
    expect(rows.some(r => r.akeneo_id === 'brand_new')).toBe(true);
  });

  it('treats a rename as an update, not delete-plus-create', async () => {
    const res = await replaceCategoryAttributes(CAT, [
      inc({ name: 'Motor Power (W)', akeneoId: 'motor_power_W' }),
    ]);
    expect(res.created).toBe(0);
    expect(res.deleted).toBe(1); // only 'trash'
    const kept = rows.find(r => r.akeneo_id === 'motor_power_W')!;
    expect(kept.id).toBe('keep');
    expect(kept.name).toBe('Motor Power (W)');
  });
});
