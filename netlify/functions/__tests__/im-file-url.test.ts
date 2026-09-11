/**
 * Signed-URL issuer for the two IM storage buckets — run against the REAL handler.
 *
 * WHY THIS FILE EXISTS AT ALL. This endpoint is the only way a reviewer reaches a published
 * manual: the portal resolves its token, then fetches the manifest and one JSON per language
 * through here. It had no tests, and it kept selecting `review_shares.template_type` after
 * migration 162 renamed that column to `subject_type`. PostgREST answered 42703, the handler
 * turned that into its generic 500, and every share and review link in production showed
 * "Could not reach manifest … Could not validate the link" — indistinguishable, from the
 * outside, from a revoked link. The fixtures below carry the POST-162 column names, and the
 * fake now refuses a select naming a column no fixture row has, so the same rename cannot
 * pass silently twice.
 *
 * The other claim worth proving here is the one the file header makes and the code cannot
 * show on its own: THE PROJECT COMES FROM THE SHARE ROW. A token minted for project A must
 * not sign an object under project B's prefix, however the caller spells the path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeDbState, type FakeSupabase } from '../lib/doc-fake-supabase';

const PROJECT = '52507ace-f200-4b0e-b552-2c7ad27ab4c8';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const USER = '99999999-9999-4999-8999-999999999999';

const TOK_REVIEW = 'live-review-token';
const TOK_VIEW = 'live-view-token';
const TOK_LEAFLET = 'live-leaflet-token';
const TOK_OTHER_PROJECT = 'live-token-for-another-project';
const TOK_REVOKED = 'revoked-token';
const TOK_EXPIRED = 'expired-token';

const MANIFEST = `${PROJECT}/im/manifest.json`;

let fake: FakeSupabase;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fake.client,
}));

/**
 * A `review_shares` row as the LIVE table shapes it — `subject_type`, not the pre-162
 * `template_type`. Every column the handler selects has to be present here for the fake's
 * column check to accept the query, which is precisely the point.
 */
const share = (token: string, over: Record<string, any> = {}) => ({
  id: `share-${token}`,
  token,
  project_id: PROJECT,
  subject_type: 'im',
  subject_id: null,
  subject_version: 4,
  mode: 'review',
  review_stage: 'draft',
  revoked_at: null,
  expires_at: null,
  label: 'Draft review v4',
  created_by: 'pm@example.com',
  created_at: '2026-09-11T11:33:02Z',
  last_used_at: null,
  use_count: 0,
  submitted_at: null,
  submitted_by: null,
  ...over,
});

const freshDb = (): FakeDbState => ({
  projects: [{ id: PROJECT }, { id: OTHER_PROJECT }],
  review_shares: [
    share(TOK_REVIEW),
    share(TOK_VIEW, { mode: 'view', review_stage: null }),
    share(TOK_LEAFLET, { subject_type: 'warning_leaflet' }),
    share(TOK_OTHER_PROJECT, { project_id: OTHER_PROJECT }),
    share(TOK_REVOKED, { revoked_at: '2026-01-01T00:00:00Z' }),
    share(TOK_EXPIRED, { expires_at: '2020-01-01T00:00:00Z' }),
  ],
});

let db: FakeDbState;

const call = async (body: unknown, headers: Record<string, string> = {}) => {
  const { handler } = await import('../im-file-url');
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
  fake = createFakeSupabase({ db, sessions: { 'user-jwt': { id: USER, email: 'pm@example.com' } } });
});

describe('the portal path reads the live review_shares columns', () => {
  it('signs the manifest for a live review token', async () => {
    const res = await call({ bucket: 'im-published', path: MANIFEST, token: TOK_REVIEW });
    expect(res.statusCode).toBe(200);
    expect(fake.signedUrlCalls).toMatchObject([
      { bucket: 'im-published', path: MANIFEST, ttl: 300 },
    ]);
  });

  // The regression itself. Selecting a column the table does not have is a 42703, which the
  // handler reports as its generic 500 — the exact symptom reviewers saw.
  it('never answers 500 on a healthy link', async () => {
    const res = await call({ bucket: 'im-published', path: MANIFEST, token: TOK_REVIEW });
    expect(res.statusCode).not.toBe(500);
  });

  it('lets a read-only view token read the same manual — only commenting is mode-gated', async () => {
    expect((await call({ bucket: 'im-published', path: MANIFEST, token: TOK_VIEW })).statusCode).toBe(200);
  });

  it('matches the document type, so an IM token cannot open the warning leaflet', async () => {
    const res = await call({
      bucket: 'im-published',
      path: `${PROJECT}/warning_leaflet/manifest.json`,
      token: TOK_REVIEW,
    });
    expect(res.statusCode).toBe(403);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('serves the leaflet to the leaflet token', async () => {
    const res = await call({
      bucket: 'im-published',
      path: `${PROJECT}/warning_leaflet/manifest.json`,
      token: TOK_LEAFLET,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('the project comes from the share row, never from the request', () => {
  it('403s a token from another project pointed at this project s manifest', async () => {
    const res = await call({ bucket: 'im-published', path: MANIFEST, token: TOK_OTHER_PROJECT });
    expect(res.statusCode).toBe(403);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('403s a revoked token — revoking a link revokes the manual behind it', async () => {
    expect((await call({ bucket: 'im-published', path: MANIFEST, token: TOK_REVOKED })).statusCode).toBe(403);
  });

  it('403s an expired token', async () => {
    expect((await call({ bucket: 'im-published', path: MANIFEST, token: TOK_EXPIRED })).statusCode).toBe(403);
  });

  it('gives unknown, revoked and expired the same message, so a probe cannot tell them apart', async () => {
    const responses = await Promise.all([
      call({ bucket: 'im-published', path: MANIFEST, token: TOK_REVOKED }),
      call({ bucket: 'im-published', path: MANIFEST, token: TOK_EXPIRED }),
      call({ bucket: 'im-published', path: MANIFEST, token: 'no-such-token' }),
    ]);
    expect(new Set(responses.map(r => JSON.parse(r.body).error)).size).toBe(1);
  });
});

describe('path and bucket validation', () => {
  it('rejects a bucket outside the two IM buckets', async () => {
    const res = await call({ bucket: 'documents', path: MANIFEST, token: TOK_REVIEW });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a traversal, a leading slash and a non-UUID prefix', async () => {
    for (const path of [
      `${PROJECT}/im/../../secret.json`,
      `/${PROJECT}/im/manifest.json`,
      `not-a-uuid/im/manifest.json`,
      `${PROJECT}/not_a_template/manifest.json`,
      `${PROJECT}/im`,
    ]) {
      const res = await call({ bucket: 'im-published', path, token: TOK_REVIEW });
      expect(res.statusCode, path).toBe(400);
    }
    expect(fake.signedUrlCalls).toHaveLength(0);
  });
});
