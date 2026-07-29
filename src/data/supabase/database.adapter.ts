/**
 * Supabase/PostgREST implementation of `DatabasePort`.
 *
 * All the PostgREST-shaped knowledge — builder chaining, `{ data, error }` results,
 * `.single()` vs `.maybeSingle()`, `head: true` counts, `@>` containment — is confined here.
 * A second adapter (SQL Server, or an HTTP client against our own API) implements the same
 * interface and nothing above `src/data/` changes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Condition,
  DatabasePort,
  OrderBy,
  SelectOptions,
  UpsertOptions,
  Where,
  WriteOptions,
} from '../ports/database.port';
import { DataAccessError } from '../ports/errors';
import { toDataError } from './errors';

const isCondition = (v: unknown): v is Condition =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'op' in (v as object);

const applyCondition = (query: any, column: string, c: Condition): any => {
  switch (c.op) {
    case 'eq': return query.eq(column, c.value);
    case 'neq': return query.neq(column, c.value);
    case 'lt': return query.lt(column, c.value);
    case 'lte': return query.lte(column, c.value);
    case 'gt': return query.gt(column, c.value);
    case 'gte': return query.gte(column, c.value);
    case 'in': return query.in(column, c.value);
    case 'isNull': return query.is(column, null);
    case 'isNotNull': return query.not(column, 'is', null);
    case 'arrayContains': return query.contains(column, c.value);
  }
};

/** Translate a declarative `Where` onto a PostgREST filter builder. */
const applyWhere = (query: any, where?: Where): any => {
  if (!where) return query;
  let q = query;
  for (const [column, raw] of Object.entries(where)) {
    // `undefined` is "no filter", so optional criteria compose without branching.
    if (raw === undefined) continue;

    if (Array.isArray(raw)) {
      // Either a list of values (IN) or several conditions to AND on this column.
      // An EMPTY array must stay an IN — it matches nothing. Treating it as "no
      // conditions" would silently widen the filter to every row, which for an
      // update or delete means hitting the whole table.
      q = raw.length > 0 && raw.every(isCondition)
        ? (raw as readonly Condition[]).reduce((acc, c) => applyCondition(acc, column, c), q)
        : q.in(column, raw);
      continue;
    }

    if (isCondition(raw)) {
      q = applyCondition(q, column, raw);
      continue;
    }

    // A bare `null` means IS NULL. PostgREST's `eq.null` would compare against the
    // literal string "null" and match nothing, so this is a correctness fix, not a shim.
    q = raw === null ? q.is(column, null) : q.eq(column, raw);
  }
  return q;
};

/**
 * Guard for mutations: refuse to run when the filter is effectively empty.
 *
 * `Where` deliberately ignores `undefined` entries so optional criteria compose without
 * branching — but that same rule turns `{ id: someUndefinedVariable }` into NO filter, which
 * for an UPDATE or DELETE means the entire table. PostgREST's `.eq('id', undefined)` used to
 * fail loudly; the declarative form would silently succeed. So it is checked here instead.
 *
 * A deliberate whole-table mutation must pass an explicit always-true condition rather than
 * an empty object, so it can never happen by accident.
 */
const assertScoped = (where: Where | undefined, context: string): void => {
  const effective = Object.values(where ?? {}).filter((v) => v !== undefined);
  if (effective.length === 0) {
    throw new DataAccessError(
      `${context}: refusing to run with an empty filter — this would affect every row. ` +
        'Check for an undefined value in the `where` clause.',
      { kind: 'permanent', context },
    );
  }
};

const applyOrder = (query: any, order?: OrderBy | readonly OrderBy[]): any => {
  if (!order) return query;
  const list = Array.isArray(order) ? order : [order as OrderBy];
  return list.reduce(
    (q, o) => q.order(o.column, { ascending: o.ascending ?? true }),
    query,
  );
};

const applySignal = (query: any, signal?: AbortSignal): any =>
  signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;

/** Await a PostgREST result, converting its in-band `{ error }` into a thrown `DataAccessError`. */
const run = async <T>(query: PromiseLike<{ data: T; error: unknown }>, context: string): Promise<T> => {
  let result: { data: T; error: unknown };
  try {
    result = await query;
  } catch (e) {
    // Transport-level throw (abort, DNS, offline) — never reaches the `{ error }` channel.
    throw toDataError(e, context);
  }
  if (result.error) throw toDataError(result.error, context);
  return result.data;
};

export const createSupabaseDatabase = (client: SupabaseClient, label: string): DatabasePort => {
  const ctx = (op: string, table: string) => `${label}.${op}(${table})`;

  const buildSelect = (table: string, options: SelectOptions = {}) => {
    let q: any = client.from(table).select(options.columns ?? '*');
    q = applyWhere(q, options.where);
    q = applyOrder(q, options.order);
    if (options.limit !== undefined) q = q.limit(options.limit);
    return applySignal(q, options.signal);
  };

  return {
    async select<T>(table, options = {}) {
      const data = await run<T[] | null>(buildSelect(table, options), ctx('select', table));
      return data ?? [];
    },

    async selectOne<T>(table, options = {}) {
      return run<T>(buildSelect(table, options).single(), ctx('selectOne', table));
    },

    async selectMaybeOne<T>(table, options = {}) {
      const data = await run<T | null>(buildSelect(table, options).maybeSingle(), ctx('selectMaybeOne', table));
      return data ?? null;
    },

    async count(table, options = {}) {
      let q: any = client.from(table).select('id', { count: 'exact', head: true });
      q = applySignal(applyWhere(q, options.where), options.signal);
      const context = ctx('count', table);
      let result: { count: number | null; error: unknown };
      try {
        result = await q;
      } catch (e) {
        throw toDataError(e, context);
      }
      if (result.error) throw toDataError(result.error, context);
      return result.count ?? 0;
    },

    async insert<T>(table, row, options: WriteOptions = {}) {
      const q = applySignal(
        client.from(table).insert(row).select(options.columns ?? '*').single(),
        options.signal,
      );
      return run<T>(q, ctx('insert', table));
    },

    async insertMany(table, rows, options: WriteOptions = {}) {
      if (rows.length === 0) return;
      const q = applySignal(client.from(table).insert(rows as object[]), options.signal);
      await run(q, ctx('insertMany', table));
    },

    async update<T>(table, values, options) {
      assertScoped(options.where, ctx('update', table));
      const q = applySignal(
        applyWhere(client.from(table).update(values), options.where).select(options.columns ?? '*').single(),
        options.signal,
      );
      return run<T>(q, ctx('update', table));
    },

    async updateWhere(table, values, options) {
      assertScoped(options.where, ctx('updateWhere', table));
      const q = applySignal(applyWhere(client.from(table).update(values), options.where), options.signal);
      await run(q, ctx('updateWhere', table));
    },

    async upsert(table, rows, options: UpsertOptions = {}) {
      const q = applySignal(
        client.from(table).upsert(rows as object, options.onConflict ? { onConflict: options.onConflict } : undefined),
        options.signal,
      );
      await run(q, ctx('upsert', table));
    },

    async upsertReturning<T>(table, row, options: UpsertOptions = {}) {
      const q = applySignal(
        client
          .from(table)
          .upsert(row, options.onConflict ? { onConflict: options.onConflict } : undefined)
          .select(options.columns ?? '*')
          .single(),
        options.signal,
      );
      return run<T>(q, ctx('upsertReturning', table));
    },

    async delete(table, options: { where: Where } & WriteOptions) {
      assertScoped(options.where, ctx('delete', table));
      const q = applySignal(applyWhere(client.from(table).delete(), options.where), options.signal);
      await run(q, ctx('delete', table));
    },

    async rpc<T>(routine, params, options: WriteOptions = {}) {
      const q = applySignal(client.rpc(routine, params), options.signal);
      return run<T>(q, ctx('rpc', routine));
    },
  };
};

export { DataAccessError };
