/**
 * Design spec file access — the security tests, run against the REAL handler.
 *
 * `design-specs` is a private bucket with no storage policies, so this function IS the
 * authorization for every design spec PDF. Two claims matter most and neither is provable by
 * reading the code:
 *
 *   1. A review token unlocks ONLY the version it was minted for. Without the subject
 *      equality check, any live review token in the system — including one for a different
 *      project's spec, or for an Instruction Manual — would unlock any spec's PDF.
 *   2. A reviewer is served the DRAFT-STAMPED copy and never the design team's original.
 *      The fake records which object path was signed, so "the stamped path was signed" is
 *      proved rather than assumed.
 *
 * `createClient` is swapped for the in-memory fake; nothing in the entitlement path is
 * stubbed. The fake enforces no RLS — it is not a Postgres — so "the caller cannot see this
 * project" is simulated by the project row being absent, which is what RLS would produce.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeDbState, type FakeSupabase } from './lib/doc-fake-supabase';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const SPEC = '33333333-3333-4333-8333-333333333333';
const OTHER_SPEC = '44444444-4444-4444-8444-444444444444';
const V_DRAFT = '55555555-5555-4555-8555-555555555555';
const V_FINAL = '66666666-6666-4666-8666-666666666666';
const V_UNSTAMPED = '77777777-7777-4777-8777-777777777777';
const V_OTHER_SPEC = '88888888-8888-4888-8888-888888888888';
const USER = '99999999-9999-4999-8999-999999999999';

const TOK_DRAFT = 'live-token-for-the-draft';
const TOK_FINAL = 'live-token-for-the-final';
const TOK_UNSTAMPED = 'live-token-for-the-unstamped-draft';
const TOK_OTHER = 'live-token-for-another-specs-version';
const TOK_REVOKED = 'revoked-token';
const TOK_EXPIRED = 'expired-token';
const TOK_VIEW = 'view-mode-token';
const TOK_IM = 'token-for-an-instruction-manual';

const ORIGINAL = `${SPEC}/aaaa-original.pdf`;
const STAMPED = `${SPEC}/aaaa-review.pdf`;

let fake: FakeSupabase;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fake.client,
}));

const spec = (id: string, projectId: string, code: string) =>
  ({ id, project_id: projectId, spec_code: code });

/**
 * The fake ignores the select string and returns whole rows, so the embedded
 * `design_specs(...)` relation is put on the fixture row directly — which also exercises the
 * handler's both-shapes unwrapping.
 */
const version = (
  id: string,
  specId: string,
  over: Record<string, any> = {},
) => ({
  id,
  spec_id: specId,
  version: 1,
  kind: 'draft',
  storage_path: ORIGINAL,
  stamped_path: STAMPED,
  design_specs: specId === SPEC
    ? spec(SPEC, PROJECT, 'DS-0001')
    : spec(OTHER_SPEC, OTHER_PROJECT, 'DS-0002'),
  ...over,
});

const share = (token: string, subjectId: string | null, over: Record<string, any> = {}) => ({
  id: `share-${token}`,
  token,
  mode: 'review',
  subject_type: 'design_spec',
  subject_id: subjectId,
  revoked_at: null,
  expires_at: null,
  ...over,
});

const freshDb = (): FakeDbState => ({
  projects: [{ id: PROJECT }, { id: OTHER_PROJECT }],
  design_spec_versions: [
    version(V_DRAFT, SPEC),
    version(V_FINAL, SPEC, { kind: 'final', version: 2, stamped_path: null }),
    version(V_UNSTAMPED, SPEC, { version: 3, stamped_path: null }),
    version(V_OTHER_SPEC, OTHER_SPEC),
  ],
  review_shares: [
    share(TOK_DRAFT, V_DRAFT),
    share(TOK_FINAL, V_FINAL),
    share(TOK_UNSTAMPED, V_UNSTAMPED),
    share(TOK_OTHER, V_OTHER_SPEC),
    share(TOK_REVOKED, V_DRAFT, { revoked_at: '2026-01-01T00:00:00Z' }),
    share(TOK_EXPIRED, V_DRAFT, { expires_at: '2020-01-01T00:00:00Z' }),
    share(TOK_VIEW, V_DRAFT, { mode: 'view' }),
    // An IM round: no subject_id, and the wrong subject_type.
    share(TOK_IM, null, { subject_type: 'im' }),
  ],
});

let db: FakeDbState;

const call = async (body: unknown, headers: Record<string, string> = {}) => {
  const { handler } = await import('./design-spec-file');
  return handler({
    httpMethod: 'POST',
    body: JSON.stringify(body),
    headers,
    queryStringParameters: {},
  } as any);
};

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  db = freshDb();
  fake = createFakeSupabase({
    db,
    sessions: { 'user-jwt': { id: USER, email: 'designer@example.com' } },
  });
});

describe('a review token unlocks only the version it was minted for', () => {
  it('serves the version its own token names', async () => {
    const res = await call({ token: TOK_DRAFT, versionId: V_DRAFT });
    expect(res.statusCode).toBe(200);
  });

  it('403s a live token from ANOTHER spec s version — the check that matters most', async () => {
    // Without the subject equality check this returns 200 and hands one project's draft to
    // another project's supplier.
    const res = await call({ token: TOK_OTHER, versionId: V_DRAFT });
    expect(res.statusCode).toBe(403);
  });

  it('403s a token whose subject is an Instruction Manual, not a design spec', async () => {
    const res = await call({ token: TOK_IM, versionId: V_DRAFT });
    expect(res.statusCode).toBe(403);
  });

  it('403s a revoked token — revoking a link revokes the PDF', async () => {
    expect((await call({ token: TOK_REVOKED, versionId: V_DRAFT })).statusCode).toBe(403);
  });

  it('403s an expired token', async () => {
    expect((await call({ token: TOK_EXPIRED, versionId: V_DRAFT })).statusCode).toBe(403);
  });

  it('403s a view-mode share — a read-only link cannot fetch a spec', async () => {
    expect((await call({ token: TOK_VIEW, versionId: V_DRAFT })).statusCode).toBe(403);
  });

  it('gives every refusal the same message, so a probe cannot tell the cases apart', async () => {
    const bodies = await Promise.all([
      call({ token: TOK_OTHER, versionId: V_DRAFT }),
      call({ token: TOK_REVOKED, versionId: V_DRAFT }),
      call({ token: TOK_EXPIRED, versionId: V_DRAFT }),
      call({ token: TOK_VIEW, versionId: V_DRAFT }),
      call({ token: 'no-such-token', versionId: V_DRAFT }),
    ]);
    const messages = new Set(bodies.map(r => JSON.parse(r.body).error));
    expect(messages.size).toBe(1);
  });
});

describe('a reviewer never receives the design team s original', () => {
  it('signs the STAMPED object for a draft', async () => {
    await call({ token: TOK_DRAFT, versionId: V_DRAFT });
    expect(fake.signedUrlCalls).toHaveLength(1);
    expect(fake.signedUrlCalls[0]).toMatchObject({ bucket: 'design-specs', path: STAMPED });
  });

  it('reports that what it served was stamped', async () => {
    const res = await call({ token: TOK_DRAFT, versionId: V_DRAFT });
    expect(JSON.parse(res.body).stamped).toBe(true);
  });

  it('409s a draft with no stamped copy rather than falling back to the original', async () => {
    // The fallback is the dangerous one: it would hand an unmarked draft to a factory the
    // moment stamping had failed.
    const res = await call({ token: TOK_UNSTAMPED, versionId: V_UNSTAMPED });
    expect(res.statusCode).toBe(409);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('serves a FINAL as uploaded, because a final carries no draft stamp', async () => {
    const res = await call({ token: TOK_FINAL, versionId: V_FINAL });
    expect(res.statusCode).toBe(200);
    expect(fake.signedUrlCalls[0].path).toBe(ORIGINAL);
    expect(JSON.parse(res.body).stamped).toBe(false);
  });

  it('uses a short TTL, so a URL out of a network log rots quickly', async () => {
    await call({ token: TOK_DRAFT, versionId: V_DRAFT });
    expect(fake.signedUrlCalls[0].ttl).toBeLessThanOrEqual(300);
  });
});

describe('the internal path', () => {
  it('401s with neither a token nor a session', async () => {
    expect((await call({ versionId: V_DRAFT })).statusCode).toBe(401);
  });

  it('401s an invalid session', async () => {
    const res = await call({ versionId: V_DRAFT }, { authorization: 'Bearer nope' });
    expect(res.statusCode).toBe(401);
  });

  it('403s a session that cannot reach the spec s project', async () => {
    // What RLS produces for a PM who is not on this project and is not a design editor.
    db.projects = db.projects.filter(p => p.id !== PROJECT);
    const res = await call({ versionId: V_DRAFT }, { authorization: 'Bearer user-jwt' });
    expect(res.statusCode).toBe(403);
  });

  it('serves the ORIGINAL to an authorized internal caller', async () => {
    const res = await call({ versionId: V_DRAFT }, { authorization: 'Bearer user-jwt' });
    expect(res.statusCode).toBe(200);
    expect(fake.signedUrlCalls[0].path).toBe(ORIGINAL);
    expect(JSON.parse(res.body).stamped).toBe(false);
  });
});

describe('input handling', () => {
  it('405s anything but POST', async () => {
    const { handler } = await import('./design-spec-file');
    const res = await handler({
      httpMethod: 'GET', body: null, headers: {}, queryStringParameters: {},
    } as any);
    expect(res.statusCode).toBe(405);
  });

  it('400s a versionId that is not a UUID, before any lookup', async () => {
    // Every value interpolated into a Storage key has to pass this.
    const res = await call({ token: TOK_DRAFT, versionId: '../../etc/passwd' });
    expect(res.statusCode).toBe(400);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('404s a version that does not exist', async () => {
    const res = await call({ token: TOK_DRAFT, versionId: '00000000-0000-4000-8000-000000000000' });
    expect(res.statusCode).toBe(404);
  });

  it('400s an unparseable body', async () => {
    const { handler } = await import('./design-spec-file');
    const res = await handler({
      httpMethod: 'POST', body: '{not json', headers: {}, queryStringParameters: {},
    } as any);
    expect(res.statusCode).toBe(400);
  });
});
