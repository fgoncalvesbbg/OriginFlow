import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_REASON_MIN_LENGTH, isValidReleaseReason } from './compliance-lock.service';

// ── The two guarantees this feature makes ────────────────────────────────────
//
//   1. A category marked FINAL cannot have its TCF requirements changed.
//   2. It can only be released by an ADMIN, and only with a written reason, and the release
//      is on the record afterwards.
//
// Both live entirely in SQL — triggers and grants — and SQL is the part no unit test can
// exercise without a database (this repo has none in CI). So they are asserted at the SOURCE
// level, the same way migration 167's import guarantee is: read the migration and check that
// the clauses which would quietly void the promise are present, and that the ones which
// would void it are absent.
//
// A source-text assertion is a blunt instrument, chosen deliberately. The failure it guards
// against is silent: somebody "simplifies" the guard to trust the UI, or adds an INSERT grant
// to the history table so a caller can log its own entries, and from then on the lock is
// decoration and the audit trail is forgeable — with nothing failing anywhere. This test
// fails loudly at that moment, and its name says why.

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, '../../../db_migrations/172_tcf_requirement_lock_and_history.sql');
const source = fs.readFileSync(MIGRATION, 'utf8');

/**
 * Comments are prose, not behaviour — and this migration's header states the very rules being
 * asserted, in the very words. Assert on statements only.
 */
const stripComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

/** The body of one `$$ … $$` function in the migration. */
function functionBody(name: string): string {
  const start = source.indexOf(`create or replace function public.${name}`);
  expect(start, `${name}() not found — did it get renamed?`).toBeGreaterThan(-1);
  const open = source.indexOf('$$', start);
  const close = source.indexOf('$$', open + 2);
  expect(close, `Unterminated $$ body for ${name}()`).toBeGreaterThan(open);
  return stripComments(source.slice(open + 2, close));
}

const statements = stripComments(source);

// SUPERSEDED IN PART. Migration 173 replaces `compliance_requirements_lock_guard` and
// `compliance_requirements_history_log` with versions that also follow a requirement's LINK
// list. The assertions below still describe 172's file — which is the right thing to assert
// about 172 — but the LIVE guard is 173's. Its guarantees are asserted in
// requirement-sharing.guarantee.test.ts, and a change to the lock has to satisfy both.

describe('FINAL means frozen — the lock is enforced in the database', () => {
  const body = functionBody('compliance_requirements_lock_guard');

  it('fires on every write to compliance_requirements, not just updates', () => {
    expect(statements).toMatch(
      /create trigger compliance_requirements_lock\s+before insert or update or delete on public\.compliance_requirements/i,
    );
  });

  it('refuses the write rather than silently dropping it', () => {
    expect(body).toMatch(/raise exception/i);
  });

  it('checks BOTH the old and the new category, so a re-parent cannot edit a frozen set', () => {
    expect(body).toContain('v_new_cat');
    expect(body).toContain('v_old_cat');
    expect(body).toMatch(/c\.id in \(v_new_cat, v_old_cat\)/);
  });

  it('reads the lock from the category table, never from a trusted parameter', () => {
    expect(body).toMatch(/from public\.categories_l3/);
    expect(body).toMatch(/c\.is_finalized/);
  });
});

describe('Releasing needs an admin AND a reason — enforced in the guard, not only the RPC', () => {
  const guard = functionBody('categories_l3_final_guard');

  it('is wired as a BEFORE trigger, so a refused release never reaches the row', () => {
    expect(statements).toMatch(
      /create trigger categories_l3_final_lock\s+before update or delete on public\.categories_l3/i,
    );
  });

  it('checks the role in the GUARD, where a direct UPDATE cannot get past it', () => {
    // The check must not live only in release_compliance_category(): that function is a front
    // door, and a plain `update categories_l3 set is_finalized = false` does not go through it.
    expect(guard).toContain('is_compliance_release_admin()');
    expect(guard).toMatch(/raise exception/i);
  });

  it('requires a reason of the same minimum length the UI enforces', () => {
    expect(guard).toMatch(
      new RegExp(`length\\(v_reason\\) < ${RELEASE_REASON_MIN_LENGTH}`),
    );
  });

  it('reads that reason from the transaction, not from a column that could be back-dated', () => {
    expect(guard).toContain("current_setting('app.compliance_release_reason', true)");
  });

  it('stamps who locked it server-side rather than trusting the client', () => {
    expect(guard).toContain('public.compliance_actor()');
    expect(guard).toMatch(/new\.finalized_by := public\.compliance_actor\(\)/);
  });

  it('refuses to delete a FINAL category, which would otherwise erase the lock', () => {
    expect(guard).toMatch(/if tg_op = 'DELETE' then[\s\S]*?raise exception/i);
  });
});

describe('The history is complete and cannot be forged', () => {
  it('is written by triggers on every requirement operation', () => {
    expect(statements).toMatch(
      /create trigger compliance_requirements_history\s+after insert or update or delete on public\.compliance_requirements/i,
    );
  });

  it('records the lock and the release too', () => {
    expect(statements).toMatch(
      /create trigger categories_l3_final_history\s+after update on public\.categories_l3/i,
    );
  });

  it('names the actor from the server, never from the payload', () => {
    expect(functionBody('compliance_requirements_history_log')).toContain('public.compliance_actor()');
    expect(functionBody('categories_l3_final_log')).toContain('public.compliance_actor()');
  });

  it('grants NOBODY insert, update or delete on the history table', () => {
    // This is the property that makes the table evidence. The triggers are SECURITY DEFINER and
    // owned by the table's owner, so they write past both the grant and the policy layer; no
    // client role needs — or gets — a write.
    expect(statements).toMatch(
      /revoke all on public\.compliance_requirement_history from anon, authenticated/i,
    );
    const grants = statements.match(/grant [^;]*on public\.compliance_requirement_history[^;]*;/gi) ?? [];
    expect(grants.length, 'expected exactly one grant on the history table').toBe(1);
    expect(grants[0].toLowerCase()).toMatch(/^grant select\s+on public\.compliance_requirement_history to authenticated;$/);
  });

  it('has no policy other than the read one', () => {
    const policies = [...statements.matchAll(
      /create policy\s+"([^"]+)"\s+on public\.compliance_requirement_history\s+for\s+(\w+)/gi,
    )];
    expect(policies.map(m => m[2].toLowerCase())).toEqual(['select']);
  });

  it('keeps no foreign keys, so a deleted category cannot empty its own history', () => {
    const table = statements.slice(
      statements.indexOf('create table if not exists public.compliance_requirement_history'),
    );
    const body = table.slice(0, table.indexOf(');'));
    expect(body.toLowerCase()).not.toContain('references');
    expect(body.toLowerCase()).not.toContain('on delete cascade');
  });
});

describe('The client-side reason check agrees with the database', () => {
  it('rejects a reason shorter than the database will accept', () => {
    expect(isValidReleaseReason('too short')).toBe(false);
    expect(isValidReleaseReason('')).toBe(false);
  });

  it('trims before measuring, exactly as the SQL does with btrim', () => {
    expect(isValidReleaseReason(`  ${'x'.repeat(RELEASE_REASON_MIN_LENGTH - 1)}  `)).toBe(false);
    expect(isValidReleaseReason(`  ${'x'.repeat(RELEASE_REASON_MIN_LENGTH)}  `)).toBe(true);
  });
});
