import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, tables } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any; columns?: string }>,
  tables: { rows: {} as Record<string, any[]>, insertError: null as unknown },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where, columns: options?.columns });
        return Promise.resolve(tables.rows[table] ?? []);
      }),
      insertMany: vi.fn((table: string, rows: any[]) => {
        calls.push({ op: 'insertMany', table, payload: rows });
        return tables.insertError ? Promise.reject(tables.insertError) : Promise.resolve();
      }),
      updateWhere: vi.fn((table: string, values: any, options: any) => {
        calls.push({ op: 'updateWhere', table, payload: values, where: options?.where });
        return Promise.resolve();
      }),
      delete: vi.fn((table: string, options: any) => {
        calls.push({ op: 'delete', table, where: options?.where });
        return Promise.resolve();
      }),
    },
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
    orUndefined: resilience.orUndefined,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  assignRegulationToTemplate,
  derivedAssignmentId,
  getTemplateRegulationCounts,
  getTemplateRegulations,
  isDerivedAssignmentId,
  unassignRegulationFromTemplate,
  updateTemplateRegulationNotes,
} from './regulation-assignment.service';

beforeEach(() => {
  calls.length = 0;
  tables.rows = {};
  tables.insertError = null;
});

const reg = (over: Record<string, any> = {}) => ({
  id: 'r1',
  title: 'Title',
  reference_code: 'AAA',
  summary_bytes: 10,
  applicable_categories: [],
  status: 'active',
  created_at: '1',
  updated_at: '1',
  ...over,
});

describe('getTemplateRegulations — the effective list', () => {
  it('includes regulations marked for the template category, with source "category"', async () => {
    // The behaviour this feature turns on: marking "Induction hob" on a regulation makes
    // it apply to that category's templates, with no explicit assignment step.
    tables.rows.im_template_regulations = [];
    tables.rows.regulations = [
      reg({ id: 'r-hob', reference_code: 'EN 60335-2-6', applicable_categories: ['cat-hob'] }),
      reg({ id: 'r-other', reference_code: 'EN 60335-2-24', applicable_categories: ['cat-fridge'] }),
    ];

    const result = await getTemplateRegulations('t1', 'cat-hob');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      regulationId: 'r-hob',
      templateId: 't1',
      source: 'category',
      id: derivedAssignmentId('r-hob'),
    });
    // A derived entry has no row, so it carries no scope note.
    expect(result[0].notes).toBeUndefined();
  });

  it('unions explicit rows with category-derived ones', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'r-explicit', notes: 'only Annex IV', created_at: '1' },
    ];
    tables.rows.regulations = [
      reg({ id: 'r-explicit', reference_code: 'ZZZ' }),
      reg({ id: 'r-cat', reference_code: 'MMM', applicable_categories: ['cat-hob'] }),
    ];

    const result = await getTemplateRegulations('t1', 'cat-hob');

    expect(result.map((r) => r.regulation?.referenceCode)).toEqual(['MMM', 'ZZZ']);
    expect(result.find((r) => r.regulationId === 'r-explicit')).toMatchObject({
      source: 'explicit', notes: 'only Annex IV',
    });
    expect(result.find((r) => r.regulationId === 'r-cat')!.source).toBe('category');
  });

  it('lets an explicit row win over the derived entry for the same regulation', async () => {
    // Otherwise the same regulation would appear twice, and the scope note on the
    // explicit row would be invisible.
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'r-both', notes: 'narrowed', created_at: '1' },
    ];
    tables.rows.regulations = [
      reg({ id: 'r-both', reference_code: 'BOTH', applicable_categories: ['cat-hob'] }),
    ];

    const result = await getTemplateRegulations('t1', 'cat-hob');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('explicit');
    expect(result[0].notes).toBe('narrowed');
  });

  it('does not pull in a superseded regulation by category', async () => {
    // 'superseded' is how a regulation is retired; it must stop reaching new templates.
    tables.rows.im_template_regulations = [];
    tables.rows.regulations = [
      reg({ id: 'r-old', status: 'superseded', applicable_categories: ['cat-hob'] }),
    ];
    expect(await getTemplateRegulations('t1', 'cat-hob')).toEqual([]);
  });

  it('STILL pulls in an expired regulation by category, so its templates can be blocked', async () => {
    // Load-bearing (migration 140). If expiry dropped the regulation from the effective
    // list, marking it expired would quietly make the template report one FEWER obligation
    // instead of blocking its publish — the exact opposite of what expiry is for.
    tables.rows.im_template_regulations = [];
    tables.rows.regulations = [
      reg({ id: 'r-dead', status: 'expired', applicable_categories: ['cat-hob'] }),
    ];

    const result = await getTemplateRegulations('t1', 'cat-hob');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ regulationId: 'r-dead', source: 'category' });
  });

  it('keeps an explicit assignment to a superseded regulation — someone chose it', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'r-old', created_at: '1' },
    ];
    tables.rows.regulations = [reg({ id: 'r-old', status: 'superseded' })];
    const result = await getTemplateRegulations('t1', 'cat-hob');
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('explicit');
  });

  it('returns explicit rows only for the category-less blank template', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't-blank', regulation_id: 'r1', created_at: '1' },
    ];
    tables.rows.regulations = [reg({ applicable_categories: ['cat-hob'] })];
    const result = await getTemplateRegulations('t-blank', null);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('explicit');
  });

  it('uses portable projections, never an embedded join', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'r1', created_at: '1' },
    ];
    tables.rows.regulations = [reg()];
    await getTemplateRegulations('t1', 'cat-hob');
    for (const call of calls) expect(call.columns ?? '').not.toMatch(/[()]/);
  });

  it('survives a library row that vanished between reads', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'gone', created_at: '1' },
    ];
    tables.rows.regulations = [];
    const [entry] = await getTemplateRegulations('t1', 'cat-hob');
    expect(entry.regulationId).toBe('gone');
    expect(entry.regulation).toBeUndefined();
  });
});

describe('getTemplateRegulationCounts', () => {
  it('counts category-derived entries, so the badge matches the modal', async () => {
    tables.rows.im_template_regulations = [];
    tables.rows.im_templates = [
      { id: 't-hob-im', category_id: 'cat-hob' },
      { id: 't-hob-leaflet', category_id: 'cat-hob' },
      { id: 't-fridge-im', category_id: 'cat-fridge' },
    ];
    tables.rows.regulations = [
      reg({ id: 'r1', applicable_categories: ['cat-hob'] }),
      reg({ id: 'r2', applicable_categories: ['cat-hob', 'cat-fridge'] }),
    ];

    // Both of the category's templates answer for it — the accepted cost of
    // auto-association is that the IM and the leaflet cannot differ here.
    expect(await getTemplateRegulationCounts()).toEqual({
      't-hob-im': 2, 't-hob-leaflet': 2, 't-fridge-im': 1,
    });
  });

  it('counts a regulation once when it is both explicitly assigned and category-marked', async () => {
    tables.rows.im_template_regulations = [
      { template_id: 't1', regulation_id: 'r1' },
    ];
    tables.rows.im_templates = [{ id: 't1', category_id: 'cat-hob' }];
    tables.rows.regulations = [reg({ id: 'r1', applicable_categories: ['cat-hob'] })];
    expect(await getTemplateRegulationCounts()).toEqual({ t1: 1 });
  });

  it('ignores a template with no category', async () => {
    tables.rows.im_template_regulations = [];
    tables.rows.im_templates = [{ id: 't-blank', category_id: null }];
    tables.rows.regulations = [reg({ applicable_categories: ['cat-hob'] })];
    expect(await getTemplateRegulationCounts()).toEqual({});
  });
});

describe('assignRegulationToTemplate', () => {
  it('writes the pair with a trimmed note and the actor', async () => {
    await assignRegulationToTemplate('t1', 'r1', '  scope note  ', 'me@example.com');
    const insert = calls.find((c) => c.op === 'insertMany')!;
    expect(insert.table).toBe('im_template_regulations');
    expect(insert.payload[0]).toMatchObject({
      template_id: 't1', regulation_id: 'r1', notes: 'scope note', assigned_by: 'me@example.com',
    });
  });

  it('stores a blank note as null rather than an empty string', async () => {
    await assignRegulationToTemplate('t1', 'r1', '   ');
    expect(calls.find((c) => c.op === 'insertMany')!.payload[0].notes).toBeNull();
  });

  it('turns the unique-pair violation into a friendly message', async () => {
    tables.insertError = new Error(
      'duplicate key value violates unique constraint "uq_im_template_regulations_pair"');
    await expect(assignRegulationToTemplate('t1', 'r1'))
      .rejects.toThrow(/already assigned to this template/);
  });
});

describe('derived ids', () => {
  it('round-trips and is recognisable', () => {
    expect(isDerivedAssignmentId(derivedAssignmentId('r1'))).toBe(true);
    expect(isDerivedAssignmentId('a-real-row-uuid')).toBe(false);
  });
});

describe('updateTemplateRegulationNotes', () => {
  it('updates the row for an explicit assignment', async () => {
    await updateTemplateRegulationNotes('a1', 'new note');
    const update = calls.find((c) => c.op === 'updateWhere')!;
    expect(update.table).toBe('im_template_regulations');
    expect(update.where).toEqual({ id: 'a1' });
    expect(update.payload.notes).toBe('new note');
    expect(update.payload.updated_at).toBeTruthy();
  });

  it('materializes a derived entry into an explicit row carrying the note', async () => {
    // A category-derived entry has no row to update — pinning a scope note to one
    // template is exactly the reason to create the explicit assignment.
    await updateTemplateRegulationNotes(derivedAssignmentId('r1'), 'only Annex IV', {
      templateId: 't1', regulationId: 'r1', actor: 'me@example.com',
    });
    expect(calls.some((c) => c.op === 'updateWhere')).toBe(false);
    const insert = calls.find((c) => c.op === 'insertMany')!;
    expect(insert.payload[0]).toMatchObject({
      template_id: 't1', regulation_id: 'r1', notes: 'only Annex IV', assigned_by: 'me@example.com',
    });
  });

  it('refuses to materialize without the ids it would need', async () => {
    await expect(updateTemplateRegulationNotes(derivedAssignmentId('r1'), 'note'))
      .rejects.toThrow(/needs the template and regulation/);
    expect(calls.some((c) => c.op === 'insertMany')).toBe(false);
  });
});

describe('unassignRegulationFromTemplate', () => {
  it('deletes only the assignment row, never the regulation', async () => {
    await unassignRegulationFromTemplate('a1');
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('im_template_regulations');
    expect(del.where).toEqual({ id: 'a1' });
  });

  it('refuses on a derived entry instead of silently doing nothing', async () => {
    await expect(unassignRegulationFromTemplate(derivedAssignmentId('r1')))
      .rejects.toThrow(/marked for this category/);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });
});
