/**
 * Covers the sync planner: what it decides to do, and — more importantly — what it refuses to
 * let happen quietly. Every 'breaking' case here is one that would otherwise strand data.
 */
import { describe, it, expect } from 'vitest';
import {
  planAttributeSync, emptyUsage, usageTotal, resolvesToGlobal,
  type AttributeUsage,
} from './attribute-sync-plan';
import type { CategoryAttribute } from '../../types';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';

const CAT = 'cat-angled-hoods';
const OTHER = 'cat-beverage-coolers';

const ex = (o: Partial<CategoryAttribute> & { id: string; name: string }): CategoryAttribute => ({
  categoryId: CAT, assignedCategoryIds: [], dataType: 'text', group: 'Category Specific', ...o,
});
const inc = (o: Partial<ParsedAttributeRow> & { name: string }): ParsedAttributeRow => ({
  group: 'Category Specific', dataType: 'text', flags: [], rawGroup: '', rawDataType: '', ...o,
});
const used = (o: Partial<AttributeUsage>): AttributeUsage => ({ ...emptyUsage(), ...o });

const find = (plan: ReturnType<typeof planAttributeSync>, name: string) =>
  plan.items.find(i => (i.incoming?.name ?? i.existing?.name) === name)!;

describe('planAttributeSync', () => {
  it('matches on the ProductToolkit id even when name AND code both changed', () => {
    // The rename case that name/code matching gets wrong: it would create a duplicate and
    // strand the 12 stored values.
    const plan = planAttributeSync(
      [ex({ id: 'a1', name: 'Power (W)', akeneoId: 'total_power', ptAttributeId: 28 })],
      [inc({ name: 'Rated power', akeneoId: 'rated_power', ptAttributeId: 28 })],
      { a1: used({ skuValues: 12 }) },
      CAT,
    );
    const item = find(plan, 'Rated power');
    expect(item.action).toBe('update');
    expect(item.matchedBy).toBe('pt-id');
    expect(plan.counts.create).toBe(0); // crucially NOT a duplicate
    expect(item.risks.map(r => r.code)).toContain('rename');
    expect(item.risks.map(r => r.code)).toContain('code-change');
  });

  it('falls back to the Akeneo code, then to name within the group', () => {
    const byCode = planAttributeSync(
      [ex({ id: 'a1', name: 'Old label', akeneoId: 'motor_power_W' })],
      [inc({ name: 'Motor Power', akeneoId: 'motor_power_W' })], {}, CAT,
    );
    expect(find(byCode, 'Motor Power').matchedBy).toBe('akeneo-code');

    const byName = planAttributeSync(
      [ex({ id: 'a1', name: 'Motor Power' })],
      [inc({ name: 'Motor Power' })], {}, CAT,
    );
    expect(find(byName, 'Motor Power').matchedBy).toBe('name-in-group');
  });

  it('flags a global → category demotion as breaking', () => {
    // The silent killer: it stops applying to every other category that relies on it.
    const plan = planAttributeSync(
      [ex({ id: 'g1', name: 'Main Color', categoryId: null, group: 'Global', assignedCategoryIds: [OTHER] })],
      [inc({ name: 'Main Color', group: 'Category Specific', scope: 'category' })],
      { g1: used({ skuValues: 40 }) },
      CAT,
    );
    const item = find(plan, 'Main Color');
    const risk = item.risks.find(r => r.code === 'scope-demotion')!;
    expect(risk.level).toBe('breaking');
    expect(risk.message).toMatch(/stop applying elsewhere/);
    expect(plan.breakingCount).toBe(1);
  });

  it('treats a promotion to global as information, not a risk', () => {
    const plan = planAttributeSync(
      [ex({ id: 'a1', name: 'SKU' })],
      [inc({ name: 'SKU', group: 'Global', scope: 'global' })], {}, CAT,
    );
    expect(find(plan, 'SKU').risks.find(r => r.code === 'scope-promotion')!.level).toBe('info');
    expect(plan.breakingCount).toBe(0);
  });

  it('flags a type change only when data actually rides on it', () => {
    const withData = planAttributeSync(
      [ex({ id: 'a1', name: 'Boost Levels', dataType: 'text' })],
      [inc({ name: 'Boost Levels', dataType: 'integer' })],
      { a1: used({ skuValues: 3 }) }, CAT,
    );
    expect(withData.breakingCount).toBe(1);

    const noData = planAttributeSync(
      [ex({ id: 'a1', name: 'Boost Levels', dataType: 'text' })],
      [inc({ name: 'Boost Levels', dataType: 'integer' })], {}, CAT,
    );
    expect(noData.breakingCount).toBe(0);
    expect(find(noData, 'Boost Levels').changes.map(c => c.field)).toContain('dataType');
  });

  it('flags removed enum options, harder when values exist', () => {
    const existing = [ex({
      id: 'a1', name: 'Chimney Material', dataType: 'enum',
      validationRules: { enumOptions: ['Aluminum foil', 'Coated Steel', 'Stainless Steel'] },
    })];
    const incoming = [inc({
      name: 'Chimney Material', dataType: 'enum', enumOptions: ['Coated Steel', 'Stainless Steel'],
    })];

    const withData = planAttributeSync(existing, incoming, { a1: used({ skuValues: 5 }) }, CAT);
    const r = find(withData, 'Chimney Material').risks.find(x => x.code === 'options-removed')!;
    expect(r.level).toBe('breaking');
    expect(r.message).toMatch(/Aluminum foil/);

    const noData = planAttributeSync(existing, incoming, {}, CAT);
    expect(noData.items[0].risks.find(x => x.code === 'options-removed')!.level).toBe('warning');
  });

  it('reports an attribute the definition dropped, and escalates it when data references it', () => {
    const plan = planAttributeSync(
      [ex({ id: 'a1', name: 'Legacy field' })], [],
      { a1: used({ imRefs: 2, skuValues: 7 }) }, CAT,
    );
    const item = find(plan, 'Legacy field');
    expect(item.action).toBe('absent');
    expect(item.risks[0].level).toBe('breaking');
    expect(item.risks[0].message).toMatch(/9 stored record/); // 7 + 2
    expect(item.risks[0].message).toMatch(/remap/);
  });

  it('does not report a dropped attribute that belongs to a different category', () => {
    const plan = planAttributeSync([ex({ id: 'x', name: 'Elsewhere', categoryId: OTHER })], [], {}, CAT);
    expect(plan.counts.absent).toBe(0);
  });

  it('lets a reviewer remap a "new" attribute onto the existing row that holds the data', () => {
    // The correction path: upstream renamed AND changed the code with no PT id to link them,
    // so the matcher sees create + absent. The reviewer points one at the other.
    const existing = [ex({ id: 'a1', name: 'Airflow max', akeneoId: 'old_code' })];
    const incoming = [inc({ name: 'Airflow maximum', akeneoId: 'new_code', ptAttributeId: 99 })];
    const usage = { a1: used({ skuValues: 20 }) };

    const before = planAttributeSync(existing, incoming, usage, CAT);
    expect(before.counts.create).toBe(1);
    expect(before.counts.absent).toBe(1);
    expect(before.breakingCount).toBe(1); // the stranded 20 values

    const after = planAttributeSync(existing, incoming, usage, CAT, { 'pt:99': 'a1' });
    expect(after.counts.create).toBe(0);
    expect(after.counts.absent).toBe(0);
    expect(after.breakingCount).toBe(0); // nothing stranded any more
    const item = find(after, 'Airflow maximum');
    expect(item.matchedBy).toBe('remap');
    expect(item.existing!.id).toBe('a1');
  });

  it("lets a reviewer force 'genuinely new' against the matcher", () => {
    const plan = planAttributeSync(
      [ex({ id: 'a1', name: 'Power', akeneoId: 'total_power' })],
      [inc({ name: 'Power', akeneoId: 'total_power', ptAttributeId: 5 })],
      {}, CAT, { 'pt:5': '' },
    );
    expect(plan.counts.create).toBe(1);
    expect(find(plan, 'Power').matchedBy).toBe('none');
  });

  it('counts an identical definition as entirely unchanged', () => {
    const plan = planAttributeSync(
      [ex({ id: 'a1', name: 'Motor Power', akeneoId: 'motor_power_W', dataType: 'integer', sortOrder: 10 })],
      [inc({ name: 'Motor Power', akeneoId: 'motor_power_W', dataType: 'integer', sortOrder: 10 })],
      {}, CAT,
    );
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.breakingCount).toBe(0);
    expect(find(plan, 'Motor Power').changes).toEqual([]);
  });

  it('prefers PT scope over the group name when deciding global', () => {
    // A row whose cluster maps to a category-scoped group but which PT calls global.
    expect(resolvesToGlobal(inc({ name: 'x', group: 'Category Specific', scope: 'global' }))).toBe(true);
    // And without scope it still infers from the group, as the CSV path always did.
    expect(resolvesToGlobal(inc({ name: 'x', group: 'Packaging' }))).toBe(true);
    expect(resolvesToGlobal(inc({ name: 'x', group: 'Category Specific' }))).toBe(false);
  });

  it('sums usage across all four dependency kinds', () => {
    expect(usageTotal(used({ skuValues: 1, requestValues: 2, reviewFlags: 3, imRefs: 4 }))).toBe(10);
  });
});

describe('buildSyncWrite', () => {
  const plan = (existing: CategoryAttribute[], incoming: ParsedAttributeRow[], usage = {}) =>
    planAttributeSync(existing, incoming, usage, CAT);

  it('reuses the existing id on update — the property that keeps references alive', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan(
      [ex({ id: 'keep-me', name: 'Power', akeneoId: 'total_power', ptAttributeId: 7 })],
      [inc({ name: 'Rated Power', akeneoId: 'total_power', ptAttributeId: 7, sortOrder: 40 })],
    );
    const write = buildSyncWrite(p.items[0], CAT)!;
    expect(write.id).toBe('keep-me');       // same row → SKU values and IM refs still resolve
    expect(write.name).toBe('Rated Power'); // but the structure is updated
    expect(write.sortOrder).toBe(40);
    expect(write.ptAttributeId).toBe(7);
  });

  it('leaves the id empty for a genuine create, for the caller to mint', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan([], [inc({ name: 'Brand new', akeneoId: 'brand_new' })]);
    expect(buildSyncWrite(p.items[0], CAT)!.id).toBe('');
  });

  it('honours PT scope when setting categoryId', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const globalRow = plan([], [inc({ name: 'G', scope: 'global', group: 'Global' })]);
    expect(buildSyncWrite(globalRow.items[0], CAT)!.categoryId).toBeNull();

    // Category scope wins even though the group is a predefined (normally global) one.
    const scoped = plan([], [inc({ name: 'C', scope: 'category', group: 'Packaging' })]);
    expect(buildSyncWrite(scoped.items[0], CAT)!.categoryId).toBe(CAT);
  });

  it('preserves validation rules it is not replacing', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan(
      [ex({ id: 'a1', name: 'Depth', dataType: 'decimal', validationRules: { min: 0, max: 99, unit: 'cm' } })],
      [inc({ name: 'Depth', dataType: 'decimal', sortOrder: 3 })],
    );
    const w = buildSyncWrite(p.items[0], CAT)!;
    expect(w.validationRules?.min).toBe(0);   // min/max are OriginFlow's, PT does not send them
    expect(w.validationRules?.max).toBe(99);
    expect(w.validationRules?.unit).toBe('cm');
  });

  it('writes nothing for an absent attribute — a sync never deletes', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan([ex({ id: 'a1', name: 'Gone' })], []);
    expect(p.items[0].action).toBe('absent');
    expect(buildSyncWrite(p.items[0], CAT)).toBeNull();
  });
});

describe('supplier-facing note', () => {
  const plan = (existing: CategoryAttribute[], incoming: ParsedAttributeRow[]) =>
    planAttributeSync(existing, incoming, {}, CAT);

  it("writes ProductToolkit's note where the supplier sees it", async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan(
      [ex({ id: 'a1', name: 'Total Power', akeneoId: 'power' })],
      [inc({ name: 'Total Power', akeneoId: 'power', note: 'Total maximum power possible.' })],
    );
    // placeholder is what AttributeInput renders under the field in every supplier form.
    expect(buildSyncWrite(p.items[0], CAT)!.validationRules?.placeholder)
      .toBe('Total maximum power possible.');
  });

  it('keeps a hand-written hint when ProductToolkit has no note', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan(
      [ex({ id: 'a1', name: 'Motor Power', akeneoId: 'motor_power_W',
            validationRules: { placeholder: 'Rated motor power in watts (W).' } })],
      // note absent, but something else changed so a write genuinely happens — that is the
      // case where a careless merge would drop the hint.
      [inc({ name: 'Motor Power', akeneoId: 'motor_power_W', sortOrder: 12 })],
    );
    expect(p.items[0].action).toBe('update');
    // An empty note means "nothing to say", not "delete what OriginFlow wrote".
    expect(buildSyncWrite(p.items[0], CAT)!.validationRules?.placeholder)
      .toBe('Rated motor power in watts (W).');
  });

  it("lets ProductToolkit's note override an existing hint, and shows it as a change", async () => {
    const p = plan(
      [ex({ id: 'a1', name: 'Standby', akeneoId: 'standby',
            validationRules: { placeholder: 'old wording' } })],
      [inc({ name: 'Standby', akeneoId: 'standby', note: 'Mandatory value by EU regulations' })],
    );
    const change = p.items[0].changes.find(c => c.field === 'note')!;
    expect(change.from).toBe('old wording');
    expect(change.to).toBe('Mandatory value by EU regulations');
  });

  it('carries required and supplierVisible through as well', async () => {
    const { buildSyncWrite } = await import('./attribute-sync-plan');
    const p = plan([], [inc({ name: 'X', akeneoId: 'x', required: true, supplierVisible: false })]);
    const w = buildSyncWrite(p.items[0], CAT)!;
    expect(w.validationRules?.required).toBe(true);
    expect(w.supplierVisible).toBe(false);
  });
});
