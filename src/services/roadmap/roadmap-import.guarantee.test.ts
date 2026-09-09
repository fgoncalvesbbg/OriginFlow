import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── The one guarantee this module makes ──────────────────────────────────────
// "Uploading a refreshed export must not remove or damage any manually entered information."
//
// That promise lives entirely in SQL, and SQL is the part no unit test can exercise without a
// database (this repo has none in CI). So this asserts it at the SOURCE level instead: it reads
// migration 167 and checks that the statements which could break the promise simply are not there.
//
// A source-text assertion is a blunt instrument, deliberately chosen. The failure it guards
// against is silent and destructive — somebody adds a tidy-up DELETE to the import, or an
// "obviously missing" foreign key, a year from now, and a quarter of the roadmap planning
// disappears on the next upload with no error anywhere. This test fails loudly at that moment,
// and its name says why.
//
// Ported from ProductToolkit's server/apps/roadmap/import.guarantee.test.js, which asserted the
// same rules against a T-SQL MERGE in repository.js.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, '../../../db_migrations/167_roadmap_creator.sql');
const source = fs.readFileSync(MIGRATION, 'utf8');

/**
 * Comments are prose, not behaviour — and this migration is heavily commented with the very
 * phrases being asserted against ("no delete branch", "never deletes"). Assert on statements only.
 */
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

/** The body of one `$$ ... $$` function in the migration. */
function functionBody(name: string): string {
  const start = source.indexOf(`create or replace function public.${name}`);
  expect(start, `${name}() not found — did it get renamed?`).toBeGreaterThan(-1);
  const open = source.indexOf('$$', start);
  const close = source.indexOf('$$', open + 2);
  expect(close, `Unterminated $$ body for ${name}()`).toBeGreaterThan(open);
  return stripComments(source.slice(open + 2, close));
}

const ANNOTATION_TABLES = ['roadmap_item_flag', 'roadmap_placer', 'roadmap_axis_value'];

describe('roadmap_import_skus — an import cannot damage manual input', () => {
  const body = functionBody('roadmap_import_skus');

  it.each(ANNOTATION_TABLES)('never mentions %s', table => {
    expect(body).not.toContain(table);
  });

  it('never deletes from roadmap_sku', () => {
    expect(body).not.toMatch(/delete\s+from\s+(public\.)?roadmap_sku\b/i);
  });

  it('contains no delete statement at all', () => {
    expect(body).not.toMatch(/\bdelete\s+from\b/i);
  });

  it('has no MERGE-style "not matched by source" clause', () => {
    // The T-SQL original relied on this clause being absent. ON CONFLICT cannot express it at
    // all, but assert anyway: if the import is ever rewritten as a MERGE (Postgres 15+ has one),
    // this is the line that would silently turn "missing from the new file" into "gone".
    expect(body.toLowerCase()).not.toContain('not matched by source');
  });

  it('is an upsert with no delete branch', () => {
    expect(body.toLowerCase()).toContain('on conflict (sku) do update set');
  });

  it('marks rows absent from the new file rather than removing them', () => {
    expect(body).toMatch(/set\s+is_current\s*=\s*false/i);
  });

  it('guards the import so an empty payload cannot blank the whole catalogue', () => {
    // Without this, a file that parsed to zero rows would reach the delist pass and mark every
    // SKU in every category as gone.
    expect(body).toMatch(/jsonb_array_length\(p_rows\)\s*=\s*0/);
    expect(body).toMatch(/raise exception 'Refusing to import an empty row set'/);
  });

  it('re-asserts the editor gate, because SECURITY DEFINER bypasses RLS', () => {
    expect(body).toMatch(/if not public\.is_roadmap_editor\(\)/);
  });

  it('never refreshes first_seen_at on an existing row', () => {
    // first_seen_at records the first-ever sighting. Putting it in the DO UPDATE list would erase
    // the only evidence of how long a SKU has been on the roadmap.
    const doUpdate = body.slice(body.toLowerCase().indexOf('do update set'));
    expect(doUpdate).not.toContain('first_seen_at');
  });
});

describe('the schema itself protects the annotations', () => {
  const sql = stripComments(source);

  it('declares no foreign keys anywhere', () => {
    // THE most important assertion in this file. A foreign key from an annotation table to
    // roadmap_sku is the single change that would delete exactly the notes this module exists to
    // protect — and it looks, to a reader tidying up the schema, like an obvious omission.
    expect(sql).not.toMatch(/\breferences\s+(public\.)?roadmap_/i);
    expect(sql).not.toMatch(/\bforeign\s+key\b/i);
  });

  it('gives the two reference tables no write policy', () => {
    // Their only writer is the SECURITY DEFINER import function. If a write policy ever appears
    // here, "reference data is written only by an import" stops being a fact of the database.
    for (const table of ['roadmap_sku', 'roadmap_import']) {
      const policies = [...sql.matchAll(/create policy\s+"([^"]+)"\s+on\s+public\.(\w+)\s+for\s+(\w+)/gi)]
        .filter(m => m[2] === table)
        .map(m => m[3].toLowerCase());
      expect(policies, `${table} should only ever have a select policy`).toEqual(['select']);
    }
  });

  it('grants the reference tables select only', () => {
    for (const table of ['roadmap_sku', 'roadmap_import']) {
      const grant = sql.match(new RegExp(`grant\\s+([\\w,\\s]+?)\\s+on\\s+public\\.${table}\\s+to`, 'i'));
      expect(grant, `no grant found for ${table}`).toBeTruthy();
      expect(grant![1].trim()).toBe('select');
    }
  });

  it('keeps the audit log append-only', () => {
    // select + insert, and nothing that could rewrite history.
    const policies = [...sql.matchAll(/create policy\s+"[^"]+"\s+on\s+public\.roadmap_audit\s+for\s+(\w+)/gi)]
      .map(m => m[1].toLowerCase())
      .sort();
    expect(policies).toEqual(['insert', 'select']);
  });

  it('keeps both partial unique indexes on the axis values', () => {
    // One four-column index is not equivalent: Postgres treats NULLs as distinct, so it would
    // allow the same family to be added twice.
    expect(sql).toMatch(/create unique index[^;]+roadmap_axis_value[^;]+where field is null/i);
    expect(sql).toMatch(/create unique index[^;]+roadmap_axis_value[^;]+where field is not null/i);
  });

  it('derives the approver list instead of hardcoding names', () => {
    // The source hardcoded MANAGERS = ["Fabio", "Nicolas"] in two files. Those people were right,
    // but a literal list stops being true the moment somebody joins or leaves — and it silently
    // keeps working, which is the bad part.
    expect(sql).not.toMatch(/'Fabio'|'Nicolas'/);
    expect(sql).toMatch(/create or replace function public\.roadmap_approvers\(\)/);
    expect(sql).toMatch(/upper\(p\.role\)\s*=\s*'ADMIN'/);
  });

  it('validates approved_by against that same list in a trigger', () => {
    // Writes go straight to PostgREST — there is no route layer left to check this in, so
    // without the trigger any editor could record an approval by anyone, or by a typo.
    expect(sql).toMatch(/create or replace function public\.roadmap_validate_approver\(\)/);
    for (const table of ['roadmap_item_flag', 'roadmap_placer']) {
      expect(sql).toMatch(
        new RegExp(`create trigger \\w+\\s+before insert or update on public\\.${table}`, 'i'),
      );
    }
  });

  it('only validates an approver when the value actually changes', () => {
    // An approval is a snapshot of who decided. Re-validating on every write would make an old
    // row unsavable once that person is renamed, loses admin, or leaves.
    const body = functionBody('roadmap_validate_approver');
    expect(body).toMatch(/new\.approved_by is distinct from old\.approved_by/);
  });

  it('enables row level security on all six tables', () => {
    const enabled = [...sql.matchAll(/alter table public\.(\w+)\s+enable row level security/gi)]
      .map(m => m[1])
      .sort();
    expect(enabled).toEqual([
      'roadmap_audit',
      'roadmap_axis_value',
      'roadmap_import',
      'roadmap_item_flag',
      'roadmap_placer',
      'roadmap_sku',
    ]);
  });
});
