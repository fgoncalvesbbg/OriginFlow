import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── The guarantee migration 173 adds ─────────────────────────────────────────
//
// "A requirement shared across categories cannot be used to change what a FINAL category
//  requires, and a shared change is visible from every category it reaches."
//
// Sharing reopens, by the back door, the exact hole migration 172 was written to close: if
// the lock guard checked only `category_id`, then editing a requirement homed in Angled Hoods
// would silently rewrite what Ceiling Hoods requires while Ceiling Hoods was locked. The fix
// is that the guard checks the whole link list, on both sides of the write.
//
// That fix lives in SQL, and SQL is the part no unit test can exercise without a database
// (this repo has none in CI). So it is asserted at the SOURCE level, the same way migration
// 167's import guarantee and 172's lock guarantee are. The failure it guards against is
// silent: somebody narrows the guard back to `category_id` during a refactor, and from then
// on every locked category with a shared requirement is quietly editable.
//
// See requirement-lock.guarantee.test.ts for the rest of the lock's guarantees. NOTE that
// 173 REPLACES 172's `compliance_requirements_lock_guard` and
// `compliance_requirements_history_log` bodies — this file asserts the live versions.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, '../../../db_migrations/173_tcf_requirements_shared_across_categories.sql');
const source = fs.readFileSync(MIGRATION, 'utf8');

const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

function functionBody(name: string): string {
  const start = source.indexOf(`create or replace function public.${name}`);
  expect(start, `${name}() not found — did it get renamed?`).toBeGreaterThan(-1);
  const open = source.indexOf('$$', start);
  const close = source.indexOf('$$', open + 2);
  expect(close, `Unterminated $$ body for ${name}()`).toBeGreaterThan(open);
  return stripComments(source.slice(open + 2, close));
}

const statements = stripComments(source);

describe('173 supersedes 172 — and says so by replacing the two bodies', () => {
  it('rewrites the lock guard and the history logger, not new functions beside them', () => {
    // Replacing the bodies is what makes the guarantee live. Adding a second, differently
    // named guard would leave 172's narrower one still attached to the table.
    expect(statements).toContain('create or replace function public.compliance_requirements_lock_guard()');
    expect(statements).toContain('create or replace function public.compliance_requirements_history_log()');
  });

  it('refuses to run before 172, rather than half-building the feature', () => {
    expect(statements).toMatch(/to_regprocedure\('public\.compliance_requirements_lock_guard\(\)'\) is null/);
    expect(statements).toMatch(/raise exception[\s\S]*?Apply 172/i);
  });
});

describe('The FINAL lock follows the link', () => {
  const body = functionBody('compliance_requirements_lock_guard');

  it('checks the link list, not just the home category', () => {
    expect(body).toContain('new.assigned_category_ids');
    expect(body).toContain('old.assigned_category_ids');
  });

  it('checks BOTH sides of the write', () => {
    // New-only would allow unlinking FROM a locked category (removing a requirement from a
    // frozen set); old-only would allow linking INTO one (adding to it). Both are changes.
    expect(body).toMatch(/if tg_op <> 'DELETE' then[\s\S]*?new\.assigned_category_ids/);
    expect(body).toMatch(/if tg_op <> 'INSERT' then[\s\S]*?old\.assigned_category_ids/);
  });

  it('matches a locked category against the whole collected set', () => {
    expect(body).toMatch(/c\.id::text = any\(v_ids\)/);
    expect(body).toContain('c.is_finalized');
  });

  it('still refuses rather than silently dropping the write', () => {
    expect(body).toMatch(/raise exception/i);
  });
});

describe('A shared change is findable from every category it reaches', () => {
  const body = functionBody('compliance_requirements_history_log');

  it('stamps the link list onto the history row', () => {
    expect(body).toContain('linked_category_ids');
    expect(body).toContain('v_linked');
  });

  it('unions before and after, so an UNLINK still shows where it was removed from', () => {
    // The category losing the requirement is precisely the one absent from `after`. Taking
    // only the after-list would hide the removal from the category it affected most.
    expect(body).toMatch(/v_linked := v_linked \|\| coalesce\(old\.assigned_category_ids/);
    expect(body).toMatch(/v_linked := v_linked \|\| coalesce\(new\.assigned_category_ids/);
  });

  it('indexes that column for containment, since every read of it is a containment test', () => {
    expect(statements).toMatch(
      /create index if not exists compliance_requirement_history_linked_idx\s+on public\.compliance_requirement_history using gin \(linked_category_ids\)/i,
    );
  });
});

describe('One canonical representation of "shared with"', () => {
  const body = functionBody('compliance_requirements_canonicalise');

  it('runs BEFORE the lock guard, so the guard sees the tidied array', () => {
    // Postgres fires BEFORE row triggers in NAME order, and this ordering is load-bearing.
    // `compliance_requirements_canonical` < `compliance_requirements_lock` alphabetically.
    expect(statements).toMatch(
      /create trigger compliance_requirements_canonical\s+before insert or update on public\.compliance_requirements/i,
    );
    expect('compliance_requirements_canonical' < 'compliance_requirements_lock').toBe(true);
  });

  it('keeps a global requirement free of assignments — it already applies everywhere', () => {
    expect(body).toMatch(/if new\.category_id is null then[\s\S]*?new\.assigned_category_ids := '\{\}'/);
  });

  it('drops duplicates, blanks, and the home category listed among its own shares', () => {
    expect(body).toContain('array_agg(distinct e order by e)');
    expect(body).toMatch(/nullif\(btrim\(e\), ''\) is not null/);
    expect(body).toMatch(/e <> new\.category_id::text/);
  });

  it('does NOT silently discard an id just because the category lookup missed', () => {
    // Validating existence here would drop a live assignment during a rename or on a lagging
    // read; a stale id is harmless because nothing resolves against it.
    expect(body).not.toContain('categories_l3');
  });
});

describe('The column is shaped like the one it deliberately copies', () => {
  it('is text[] NOT NULL DEFAULT {} — the same as category_attributes', () => {
    expect(statements).toMatch(
      /add column if not exists assigned_category_ids text\[\] not null default '\{\}'/i,
    );
  });

  it('is GIN-indexed, because resolution asks "which requirements reach this category"', () => {
    expect(statements).toMatch(
      /create index if not exists compliance_requirements_assigned_idx\s+on public\.compliance_requirements using gin \(assigned_category_ids\)/i,
    );
  });

  it('carries no foreign key, which a postgres array cannot have anyway', () => {
    const alter = statements.slice(statements.indexOf('alter table public.compliance_requirements'));
    expect(alter.slice(0, alter.indexOf(';')).toLowerCase()).not.toContain('references');
  });
});
