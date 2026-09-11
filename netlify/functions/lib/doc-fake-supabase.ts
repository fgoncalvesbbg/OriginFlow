/**
 * A minimal in-memory stand-in for the Supabase client, for the doc_* route tests.
 *
 * WHY NOT MOCK THE HANDLERS' OWN HELPERS: the interesting failures in this module are
 * exactly the ones a mocked helper hides. "A supplier cannot read an internal document" is
 * only proved by running the REAL handler, with the REAL entitlement code, against a
 * database that genuinely contains that internal document — a stubbed
 * `loadEntitledVersion` would pass whatever it was told to pass.
 *
 * So this fake goes one layer lower: tests mock `createClient` from @supabase/supabase-js,
 * every handler builds its client the way it does in production, and the rows come from
 * here. The fake deliberately returns FULL rows including `sharepoint_link`, so a test
 * that finds no link in a response has proved the DTO dropped it rather than that the
 * fixture never had one.
 *
 * Not a Postgres. It implements only the query surface these three handlers actually use,
 * and it does not enforce RLS, constraints or the unique partial index — those are the
 * database's job and are verified by the checks at the bottom of migration 159.
 */

type Row = Record<string, any>;

interface Filter {
  op: 'eq' | 'in' | 'contains' | 'ilike' | 'is';
  column: string;
  value: any;
}

export interface FakeDbState {
  [table: string]: Row[];
}

const matches = (row: Row, filter: Filter): boolean => {
  const actual = row[filter.column];
  switch (filter.op) {
    case 'eq':
      return actual === filter.value;
    case 'is':
      return filter.value === null ? actual == null : actual === filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case 'contains':
      return Array.isArray(actual) && (filter.value as any[]).every(v => actual.includes(v));
    case 'ilike': {
      const pattern = String(filter.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(String(actual ?? ''));
    }
    default:
      return false;
  }
};

/**
 * Split a PostgREST select list on TOP-LEVEL commas, so an embedded relation's own column
 * list (`design_specs(id, project_id)`) stays in one piece instead of being torn apart.
 */
const splitSelect = (columns: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of columns) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map(c => c.trim()).filter(Boolean);
};

/**
 * The PostgREST error a select naming a column the table does not have would really produce.
 *
 * WHY THIS EXISTS. `select()` used to ignore its argument entirely, which made the fake blind
 * to the single most common way this codebase breaks a live endpoint: a migration renames a
 * column and one query keeps the old name. That is not hypothetical — `im-file-url.ts` kept
 * selecting `template_type` from `review_shares` after migration 162 renamed it
 * `subject_type`, and every supplier review link 500'd for two days while every test passed.
 *
 * Checked against the KEYS PRESENT ON THE FIXTURE ROWS, not against a schema the fake does
 * not have, so it only ever fires on a name no fixture row carries. Embedded relations,
 * `*`, and a table with no rows are all skipped — there is nothing to check them against.
 */
const unknownColumnError = (table: string, columns: string | undefined, rows: Row[]) => {
  if (!columns || columns.trim() === '*' || rows.length === 0) return null;
  const known = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) known.add(key);
  for (const part of splitSelect(columns)) {
    // An embedded relation (`table(cols)`) or a star — nothing to verify here.
    if (part.includes('(') || part === '*') continue;
    // `alias:column` renames on the way out; the real column is after the colon.
    const column = (part.includes(':') ? part.slice(part.indexOf(':') + 1) : part).trim();
    if (!column || column === '*') continue;
    if (!known.has(column)) {
      return {
        code: '42703',
        message: `column ${table}.${column} does not exist`,
        details: null,
        hint: `Perhaps you meant to reference one of: ${[...known].join(', ')}`,
      };
    }
  }
  return null;
};

/** A thenable query builder: `await q` resolves to a list, `.maybeSingle()` to one row. */
class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  /**
   * `failure` short-circuits every resolution path with that error and no rows — how
   * PostgREST answers a bad select. Handlers see it through their own error branch rather
   * than through a thrown exception, which is what production does.
   */
  constructor(private readonly rows: Row[], private readonly failure: any = null) {}

  eq(column: string, value: any) { this.filters.push({ op: 'eq', column, value }); return this; }
  is(column: string, value: any) { this.filters.push({ op: 'is', column, value }); return this; }
  in(column: string, value: any[]) { this.filters.push({ op: 'in', column, value }); return this; }
  contains(column: string, value: any[]) { this.filters.push({ op: 'contains', column, value }); return this; }
  ilike(column: string, value: string) { this.filters.push({ op: 'ilike', column, value }); return this; }
  order(column: string, opts?: { ascending?: boolean }) {
    this.sort = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) { this.max = n; return this; }
  select() { return this; }

  private resolveRows(): Row[] {
    let out = this.rows.filter(r => this.filters.every(f => matches(r, f)));
    if (this.sort) {
      const { column, ascending } = this.sort;
      out = [...out].sort((a, b) => {
        const av = a[column]; const bv = b[column];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
      });
    }
    if (this.max != null) out = out.slice(0, this.max);
    // Deep-cloned so a handler mutating a result cannot reach back into the fixture.
    return out.map(r => JSON.parse(JSON.stringify(r)));
  }

  async maybeSingle() {
    if (this.failure) return { data: null, error: this.failure };
    const out = this.resolveRows();
    return { data: out[0] ?? null, error: null };
  }

  async single() {
    if (this.failure) return { data: null, error: this.failure };
    const out = this.resolveRows();
    if (out.length !== 1) return { data: null, error: { message: 'expected exactly one row', code: 'PGRST116' } };
    return { data: out[0], error: null };
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(
      this.failure ? { data: null, error: this.failure } : { data: this.resolveRows(), error: null },
    ).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabaseOptions {
  /** Rows by table name. Mutated in place by inserts, so a test can assert on them after. */
  db: FakeDbState;
  /** Bearer token -> the auth.getUser() result. An unknown token is rejected. */
  sessions?: Record<string, { id: string; email?: string }>;
  /** RPC name -> handler. Unlisted RPCs resolve to { data: null, error: null }. */
  rpc?: Record<string, (args: Record<string, any>) => { data?: any; error?: any }>;
  /** Signed URL to hand back from storage.createSignedUrl. */
  signedUrl?: string;
}

export interface FakeSupabase {
  client: any;
  /** Every signed URL minted, so a test can assert the TTL and the filename. */
  signedUrlCalls: { bucket: string; path: string; ttl: number; options?: any }[];
  /** Every insert, so a test can assert the access log was written. */
  inserts: { table: string; rows: Row[] }[];
}

export const createFakeSupabase = (options: FakeSupabaseOptions): FakeSupabase => {
  const { db, sessions = {}, rpc = {}, signedUrl = 'https://storage.test/signed?token=abc' } = options;
  const signedUrlCalls: FakeSupabase['signedUrlCalls'] = [];
  const inserts: FakeSupabase['inserts'] = [];

  const table = (name: string): Row[] => (db[name] ||= []);

  const client = {
    auth: {
      getUser: async (token: string) => {
        const user = sessions[token];
        if (!user) return { data: null, error: { message: 'invalid token' } };
        return { data: { user: { id: user.id, email: user.email ?? null } }, error: null };
      },
    },

    from: (name: string) => ({
      select: (columns?: string) => new FakeQuery(table(name), unknownColumnError(name, columns, table(name))),
      insert: (rows: Row | Row[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        inserts.push({ table: name, rows: list });
        table(name).push(...list);
        const inserted = new FakeQuery(list);
        return {
          select: () => inserted,
          then: (r: any) => Promise.resolve({ data: list, error: null }).then(r),
        };
      },
      upsert: (rows: Row | Row[]) => {
        const list = Array.isArray(rows) ? rows : [rows];
        inserts.push({ table: name, rows: list });
        table(name).push(...list);
        return Promise.resolve({ data: list, error: null });
      },
      update: (patch: Row) => ({
        eq: (column: string, value: any) => ({
          select: () => {
            const hit = table(name).filter(r => r[column] === value);
            hit.forEach(r => Object.assign(r, patch));
            return new FakeQuery(hit);
          },
        }),
      }),
      delete: () => {
        const filters: Filter[] = [];
        const chain: any = {
          eq(column: string, value: any) {
            filters.push({ op: 'eq', column, value });
            return chain;
          },
          then(resolve: any) {
            const rows = table(name);
            for (let i = rows.length - 1; i >= 0; i--) {
              if (filters.every(f => matches(rows[i], f))) rows.splice(i, 1);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return chain;
      },
    }),

    rpc: async (name: string, args: Record<string, any>) => {
      const impl = rpc[name];
      if (!impl) return { data: null, error: null };
      const result = impl(args);
      return { data: result.data ?? null, error: result.error ?? null };
    },

    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttl: number, opts?: any) => {
          signedUrlCalls.push({ bucket, path, ttl, options: opts });
          return { data: { signedUrl }, error: null };
        },
        createSignedUploadUrl: async (path: string) => ({
          data: { signedUrl: `${signedUrl}&path=${path}`, token: 'upload-token' },
          error: null,
        }),
        remove: async () => ({ data: null, error: null }),
        list: async () => ({ data: [], error: null }),
        download: async () => ({ data: null, error: { message: 'not implemented' } }),
      }),
    },
  };

  return { client, signedUrlCalls, inserts };
};
