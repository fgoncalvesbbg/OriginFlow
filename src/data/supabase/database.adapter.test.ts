/**
 * Tests for the query-translation layer — the part of the migration most likely to change
 * behaviour silently. Each case pins a translation decision that a service now depends on.
 */
import { describe, it, expect } from 'vitest';
import { createSupabaseDatabase } from './database.adapter';

/**
 * Minimal chainable stand-in for a postgrest builder: every filter method records its call
 * and returns itself, and the builder is thenable so `await` yields a controllable result.
 */
const makeFakeClient = (result: { data?: any; error?: any; count?: number } = {}) => {
  const calls: Array<[string, ...any[]]> = [];
  const builder: any = {};
  const record = (name: string) => (...args: any[]) => { calls.push([name, ...args]); return builder; };
  for (const m of [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'is', 'not', 'contains',
    'order', 'limit', 'abortSignal', 'single', 'maybeSingle',
  ]) builder[m] = record(m);
  builder.then = (res: any, rej: any) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null })
      .then(res, rej);

  const client: any = {
    from: (table: string) => { calls.push(['from', table]); return builder; },
    rpc: record('rpc'),
  };
  return { client, calls };
};

/** All recorded calls for one filter method, as argument tuples. */
const argsFor = (calls: Array<[string, ...any[]]>, method: string) =>
  calls.filter((c) => c[0] === method).map((c) => c.slice(1));

describe('where translation', () => {
  it('maps a scalar to equality and a bare null to IS NULL', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await createSupabaseDatabase(client, 'db').select('t', {
      where: { name: 'x', category_id: null },
    });
    expect(argsFor(calls, 'eq')).toEqual([['name', 'x']]);
    // `eq.null` would compare against the literal string "null" and match nothing.
    expect(argsFor(calls, 'is')).toEqual([['category_id', null]]);
  });

  it('maps an array to IN, and keeps an EMPTY array as IN so it matches nothing', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await createSupabaseDatabase(client, 'db').select('t', { where: { id: [], other: ['a', 'b'] } });
    // An empty array must NOT collapse to "no filter" — that would widen to every row.
    expect(argsFor(calls, 'in')).toEqual([['id', []], ['other', ['a', 'b']]]);
  });

  it('applies several conditions on the same column', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await createSupabaseDatabase(client, 'db').select('t', {
      where: { deadline: [{ op: 'isNotNull' }, { op: 'lte', value: '2026-01-01' }] },
    });
    expect(argsFor(calls, 'not')).toEqual([['deadline', 'is', null]]);
    expect(argsFor(calls, 'lte')).toEqual([['deadline', '2026-01-01']]);
  });

  it('drops undefined entries so optional filters compose without branching', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await createSupabaseDatabase(client, 'db').select('t', {
      where: { status: 'open', category: undefined },
    });
    expect(argsFor(calls, 'eq')).toEqual([['status', 'open']]);
  });

  it('maps arrayContains to containment', async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await createSupabaseDatabase(client, 'db').select('t', {
      where: { applicable_categories: { op: 'arrayContains', value: ['c1'] } },
    });
    expect(argsFor(calls, 'contains')).toEqual([['applicable_categories', ['c1']]]);
  });
});

describe('mutation safety guard', () => {
  it('refuses a delete with an empty filter', async () => {
    const { client, calls } = makeFakeClient();
    await expect(createSupabaseDatabase(client, 'db').delete('projects', { where: {} }))
      .rejects.toThrow(/empty filter/);
    // Nothing was sent to the driver at all.
    expect(calls).toEqual([]);
  });

  it('refuses a delete whose only filter value is undefined', async () => {
    const { client } = makeFakeClient();
    const id = undefined as unknown as string;
    await expect(createSupabaseDatabase(client, 'db').delete('projects', { where: { id } }))
      .rejects.toThrow(/empty filter/);
  });

  it('refuses an unscoped update', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      createSupabaseDatabase(client, 'db').updateWhere('projects', { name: 'x' }, { where: { id: undefined } }),
    ).rejects.toThrow(/empty filter/);
    expect(calls).toEqual([]);
  });

  it('allows a properly scoped delete', async () => {
    const { client, calls } = makeFakeClient();
    await createSupabaseDatabase(client, 'db').delete('projects', { where: { id: 'p1' } });
    expect(argsFor(calls, 'eq')).toEqual([['id', 'p1']]);
  });
});

describe('result handling', () => {
  it('returns [] rather than null for an empty select', async () => {
    const { client } = makeFakeClient({ data: null });
    await expect(createSupabaseDatabase(client, 'db').select('t')).resolves.toEqual([]);
  });

  it('converts an in-band driver error into a thrown DataAccessError with its code', async () => {
    const { client } = makeFakeClient({ error: { message: 'duplicate key', code: '23505' } });
    await expect(createSupabaseDatabase(client, 'db').insert('t', { a: 1 })).rejects.toMatchObject({
      name: 'DataAccessError',
      kind: 'permanent',
      driverCode: '23505',
    });
  });

  it('classifies an unknown failure as transient so it stays retryable', async () => {
    const { client } = makeFakeClient({ error: { message: 'Failed to fetch' } });
    await expect(createSupabaseDatabase(client, 'db').insert('t', { a: 1 })).rejects.toMatchObject({
      kind: 'transient',
    });
  });

  it('reports a count of zero when the driver returns no count', async () => {
    const { client } = makeFakeClient({ count: null as any });
    await expect(createSupabaseDatabase(client, 'db').count('t', { where: { x: 1 } })).resolves.toBe(0);
  });
});
