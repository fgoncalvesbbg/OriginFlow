#!/usr/bin/env node
/**
 * Reconcile db_migrations/ against the live database.
 *
 * WHY THIS EXISTS. The folder is a change log, not a schema definition, and neither git
 * nor `supabase_migrations.schema_migrations` can tell you what has been applied — see
 * db_migrations/STATUS.md for the full account. The only reliable answer is "does the
 * object this migration creates exist in the database". This script asks that question
 * for every file at once.
 *
 * HOW. It parses each migration for the first object it creates (table, column, function,
 * view, policy or index) and emits ONE SQL query that makes the database compute
 * applied-vs-pending for all of them. Deliberately no DB connection here: the repo has no
 * Postgres password (only an API URL and service-role key), so run the emitted SQL through
 * the Supabase MCP `execute_sql` tool, the dashboard SQL editor, or psql.
 *
 *   node scripts/reconcile-migrations.mjs db_migrations recon.sql
 *
 * READ THE OUTPUT WITH CARE. A PENDING verdict means "the signature object is absent",
 * which has three possible causes, and only one of them is an actual missing migration:
 *   1. genuinely never applied;
 *   2. applied, then deliberately superseded — a later migration renamed or dropped the
 *      object (6 files were in this state at the 2026-09-09 reconciliation);
 *   3. the signature was mis-parsed.
 * Always confirm a PENDING by reading the file before acting on it.
 *
 * TWO PARSING TRAPS, both of which produced wrong verdicts before being fixed:
 *   - `CREATE TABLE other_schema.x` — 139 and 145 write into `private_archive`, so the
 *     schema must be captured and checked, not assumed to be `public`.
 *   - Storage bucket policies live in `schemaname = 'storage'`, not `'public'`, so the
 *     policy and index checks below deliberately do not filter on schema.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'db_migrations';
const OUT = process.argv[3] ?? 'recon.sql';

const files = readdirSync(DIR)
  .filter(f => /\.(sql|txt)$/i.test(f))
  .sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (Number.isNaN(na) && Number.isNaN(nb)) return a.localeCompare(b);
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb || a.localeCompare(b);
  });

/** Strip block and line comments so commented-out DDL never counts as a signature. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

/** Split `schema.name` / `name` / quoted forms into [schema, name]. */
const qualify = raw => {
  const parts = raw.split('.').map(p => p.replace(/"/g, ''));
  return parts.length > 1 ? [parts[0], parts[1]] : ['public', parts[0]];
};

const rows = [];
for (const f of files) {
  const sql = strip(readFileSync(join(DIR, f), 'utf8'));

  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z0-9_]+"?\.)?"?[a-z0-9_]+"?)/gi)].map(m => qualify(m[1]));
  const views = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+((?:"?[a-z0-9_]+"?\.)?"?[a-z0-9_]+"?)/gi)].map(m => qualify(m[1]));
  const funcs = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)].map(m => m[1]);
  const pols = [...sql.matchAll(/create\s+policy\s+"([^"]+)"/gi)].map(m => m[1]);
  const idx = [...sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)].map(m => m[1]);

  // ALTER TABLE t ... ADD COLUMN [IF NOT EXISTS] c — one statement may add several.
  const cols = [];
  for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?((?:"?[a-z0-9_]+"?\.)?"?[a-z0-9_]+"?)([\s\S]*?)(?=;)/gi)) {
    const [, t] = qualify(m[1]);
    for (const c of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) cols.push([t, c[1]]);
  }

  let kind = 'none', schema = 'public', a = null, b = null;
  if (tables.length) { kind = 'table'; [schema, a] = tables[0]; }
  else if (cols.length) { kind = 'column'; [a, b] = cols[0]; }
  else if (funcs.length) { kind = 'func'; a = funcs[0]; }
  else if (views.length) { kind = 'view'; [schema, a] = views[0]; }
  else if (pols.length) { kind = 'policy'; a = pols[0]; }
  else if (idx.length) { kind = 'index'; a = idx[0]; }

  rows.push({ f, kind, schema, a, b });
}

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const values = rows
  .map(r => `(${q(r.f)},${q(r.kind)},${q(r.schema)},${r.a ? q(r.a) : 'null'},${r.b ? q(r.b) : 'null'})`)
  .join(',');

// Policy and index checks intentionally omit a schema filter — storage policies live in
// `storage`, and filtering on `public` reported bucket migrations as pending.
const sql = `with m(f,kind,sch,a,b) as (values ${values}),
v as (select m.f, m.kind, coalesce(m.a,'') || coalesce('.'||m.b,'') as obj,
  case
    when m.kind='none'   then 'NOT-CHECKABLE'
    when m.kind='table'  then case when exists(select 1 from information_schema.tables  where table_schema=m.sch and table_name=m.a) then 'APPLIED' else 'PENDING' end
    when m.kind='view'   then case when exists(select 1 from information_schema.views   where table_schema=m.sch and table_name=m.a) then 'APPLIED' else 'PENDING' end
    when m.kind='column' then case when exists(select 1 from information_schema.columns where table_schema='public' and table_name=m.a and column_name=m.b) then 'APPLIED' else 'PENDING' end
    when m.kind='func'   then case when exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=m.a) then 'APPLIED' else 'PENDING' end
    when m.kind='policy' then case when exists(select 1 from pg_policies where policyname=m.a) then 'APPLIED' else 'PENDING' end
    when m.kind='index'  then case when exists(select 1 from pg_indexes  where indexname=m.a) then 'APPLIED' else 'PENDING' end
  end as verdict
from m)
select verdict, f, kind, obj,
 (select count(*) from v where verdict='APPLIED') as n_applied,
 (select count(*) from v where verdict='PENDING') as n_pending,
 (select count(*) from v where verdict='NOT-CHECKABLE') as n_not_checkable
from v where verdict <> 'APPLIED' order by verdict, f;`;

writeFileSync(OUT, sql);

const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
console.log(`parsed ${rows.length} files from ${DIR}`);
console.log(`signature kinds: ${JSON.stringify(byKind)}`);
console.log(`no signature (effect not checkable by existence): ${rows.filter(r => r.kind === 'none').length}`);
console.log(`\nwrote ${OUT} (${sql.length} bytes) — run it against the live database.`);
