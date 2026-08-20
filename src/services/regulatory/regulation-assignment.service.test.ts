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
  getTemplateRegulationCounts,
  getTemplateRegulations,
  unassignRegulationFromTemplate,
  updateTemplateRegulationNotes,
} from './regulation-assignment.service';

beforeEach(() => {
  calls.length = 0;
  tables.rows = {};
  tables.insertError = null;
});

describe('getTemplateRegulations', () => {
  it('does two portable reads and stitches, never an embedded join', async () => {
    // PORTING.md inventories every PostgREST embedded join as debt a non-PostgREST
    // adapter owes; two reads cost one round trip and add none.
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'r-zulu', notes: 'only Annex IV', assigned_by: 'me', created_at: '1' },
      { id: 'a2', template_id: 't1', regulation_id: 'r-alpha', notes: null, created_at: '2' },
    ];
    tables.rows.regulations = [
      { id: 'r-alpha', title: 'Alpha', reference_code: 'AAA', summary_bytes: 10, applicable_categories: [], status: 'active', created_at: '1', updated_at: '1' },
      { id: 'r-zulu', title: 'Zulu', reference_code: 'ZZZ', summary_bytes: 20, applicable_categories: [], status: 'active', created_at: '1', updated_at: '1' },
    ];

    const result = await getTemplateRegulations('t1');

    for (const call of calls) expect(call.columns ?? '').not.toMatch(/[()]/);
    // Ordered by the library's reference code, so the list reads like the library.
    expect(result.map((r) => r.regulation?.referenceCode)).toEqual(['AAA', 'ZZZ']);
    expect(result.find((r) => r.id === 'a1')).toMatchObject({
      templateId: 't1', regulationId: 'r-zulu', notes: 'only Annex IV', assignedBy: 'me',
    });
    expect(result.find((r) => r.id === 'a2')!.notes).toBeUndefined();
  });

  it('skips the library read entirely when nothing is assigned', async () => {
    tables.rows.im_template_regulations = [];
    expect(await getTemplateRegulations('t1')).toEqual([]);
    expect(calls.some((c) => c.table === 'regulations')).toBe(false);
  });

  it('survives a library row that vanished between the two reads', async () => {
    tables.rows.im_template_regulations = [
      { id: 'a1', template_id: 't1', regulation_id: 'gone', created_at: '1' },
    ];
    tables.rows.regulations = [];
    const [entry] = await getTemplateRegulations('t1');
    expect(entry.regulationId).toBe('gone');
    expect(entry.regulation).toBeUndefined();
  });
});

describe('getTemplateRegulationCounts', () => {
  it('tallies per template from a template_id projection', async () => {
    tables.rows.im_template_regulations = [
      { template_id: 't1' }, { template_id: 't1' }, { template_id: 't2' },
    ];
    expect(await getTemplateRegulationCounts()).toEqual({ t1: 2, t2: 1 });
    expect(calls[0].columns).toBe('template_id');
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

describe('updateTemplateRegulationNotes / unassign', () => {
  it('updates the note and stamps updated_at', async () => {
    await updateTemplateRegulationNotes('a1', 'new note');
    const update = calls.find((c) => c.op === 'updateWhere')!;
    expect(update.table).toBe('im_template_regulations');
    expect(update.where).toEqual({ id: 'a1' });
    expect(update.payload.notes).toBe('new note');
    expect(update.payload.updated_at).toBeTruthy();
  });

  it('deletes only the assignment row, never the regulation', async () => {
    await unassignRegulationFromTemplate('a1');
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('im_template_regulations');
    expect(del.where).toEqual({ id: 'a1' });
  });
});
