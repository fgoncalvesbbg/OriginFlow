/**
 * Supplier IM draft intake — the security tests, run against the REAL handler.
 *
 * `im-drafts` is a private bucket with no storage policies and both draft tables are
 * RLS-scoped to can_see_project, so this function IS the authorization for every draft PDF.
 * Four claims matter most, and none of them is provable by reading the code:
 *
 *   1. A review token unlocks ONLY the upload it was minted for. Without the subject
 *      equality check, any live review token in the system — including a DESIGN SPEC's, or
 *      another project's draft — would unlock this PDF. This is the single most important
 *      test in the file.
 *   2. Every reviewer-side refusal is indistinguishable. Revoked, expired, view-mode,
 *      wrong-subject and withdrawn all return the same string, so the endpoint cannot be
 *      used as an oracle to discover which is true.
 *   3. A supplier reaches only their own projects' requests — and a supplier credential
 *      cannot be pointed at a request on someone else's project.
 *   4. A file that is not a PDF is DELETED from the bucket and refused, so a rejected
 *      upload cannot linger.
 *
 * `createClient` is swapped for the in-memory fake; nothing in the credential path is
 * stubbed. The fake enforces no RLS — it is not a Postgres — so "the caller cannot see this
 * project" is simulated by the row being absent, which is what RLS would produce.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeDbState, type FakeSupabase } from '../lib/doc-fake-supabase';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const OTHER_REQUEST = '44444444-4444-4444-8444-444444444444';
const CANCELLED_REQUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UPLOAD = '55555555-5555-4555-8555-555555555555';
const OTHER_UPLOAD = '66666666-6666-4666-8666-666666666666';
const WITHDRAWN_UPLOAD = '77777777-7777-4777-8777-777777777777';
const NEW_UPLOAD = '88888888-8888-4888-8888-888888888888';
const USER = '99999999-9999-4999-8999-999999999999';

const TOK_OK = 'live-token-for-this-draft';
const TOK_OTHER_DRAFT = 'live-token-for-another-projects-draft';
const TOK_DESIGN_SPEC = 'live-token-for-a-design-spec';
const TOK_REVOKED = 'revoked-token';
const TOK_EXPIRED = 'expired-token';
const TOK_VIEW = 'view-mode-token';
const TOK_WITHDRAWN = 'token-for-a-withdrawn-upload';

const PROJECT_TOKEN = 'project-portal-token';
const OTHER_PROJECT_TOKEN = 'other-project-portal-token';
const SUPPLIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUPPLIER_TOKEN = 'supplier-portal-token';
const ACCESS_CODE = 'CODE-1234';

const QM_CODE = 'the-right-code';

const PATH = `${REQUEST}/${UPLOAD}-draft.pdf`;
const DEAD_LINK = 'This review link is invalid, expired or has been revoked.';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const NOT_PDF_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

let fake: FakeSupabase;
let files: Record<string, Uint8Array>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fake.client,
}));

const upload = (id: string, requestId: string, projectId: string, over: Record<string, any> = {}) => ({
  id,
  request_id: requestId,
  version: 1,
  storage_path: `${requestId}/${id}-draft.pdf`,
  withdrawn_at: null,
  page_count: 12,
  uploaded_at: '2026-09-10T10:00:00Z',
  uploaded_by_name: 'Supplier Sam',
  original_filename: 'draft.pdf',
  // The fake ignores the select string and returns whole rows, so the embedded relation is
  // put on the fixture directly.
  im_draft_requests: { project_id: projectId },
  ...over,
});

const share = (token: string, subjectId: string | null, over: Record<string, any> = {}) => ({
  id: `share-${token}`,
  token,
  mode: 'review',
  subject_type: 'im_draft',
  subject_id: subjectId,
  subject_version: 1,
  project_id: PROJECT,
  created_at: '2026-09-10T10:00:00Z',
  submitted_at: null,
  revoked_at: null,
  expires_at: null,
  projects: { name: 'Cook Pro', project_id_code: 'P-1042' },
  ...over,
});

const freshDb = (): FakeDbState => ({
  projects: [
    { id: PROJECT, supplier_link_token: PROJECT_TOKEN, supplier_id: SUPPLIER, name: 'Cook Pro', project_id_code: 'P-1042' },
    { id: OTHER_PROJECT, supplier_link_token: OTHER_PROJECT_TOKEN, supplier_id: null, name: 'Hood X', project_id_code: 'P-1057' },
  ],
  suppliers: [{ id: SUPPLIER, portal_token: SUPPLIER_TOKEN, access_code: ACCESS_CODE }],
  im_draft_requests: [
    { id: REQUEST, project_id: PROJECT, template_type: 'im', requested_at: '2026-09-01T00:00:00Z', due_date: null, note: null, cancelled_at: null, projects: { name: 'Cook Pro', project_id_code: 'P-1042' } },
    { id: OTHER_REQUEST, project_id: OTHER_PROJECT, template_type: 'im', requested_at: '2026-09-01T00:00:00Z', due_date: null, note: null, cancelled_at: null, projects: { name: 'Hood X', project_id_code: 'P-1057' } },
    { id: CANCELLED_REQUEST, project_id: PROJECT, template_type: 'warning_leaflet', requested_at: '2026-09-01T00:00:00Z', due_date: null, note: null, cancelled_at: '2026-09-05T00:00:00Z', projects: { name: 'Cook Pro', project_id_code: 'P-1042' } },
  ],
  im_draft_uploads: [
    upload(UPLOAD, REQUEST, PROJECT),
    upload(OTHER_UPLOAD, OTHER_REQUEST, OTHER_PROJECT),
    upload(WITHDRAWN_UPLOAD, REQUEST, PROJECT, { withdrawn_at: '2026-09-09T00:00:00Z', version: 2 }),
  ],
  review_shares: [
    share(TOK_OK, UPLOAD),
    share(TOK_OTHER_DRAFT, OTHER_UPLOAD, { project_id: OTHER_PROJECT }),
    share(TOK_DESIGN_SPEC, UPLOAD, { subject_type: 'design_spec' }),
    share(TOK_REVOKED, UPLOAD, { revoked_at: '2026-01-01T00:00:00Z' }),
    share(TOK_EXPIRED, UPLOAD, { expires_at: '2020-01-01T00:00:00Z' }),
    share(TOK_VIEW, UPLOAD, { mode: 'view' }),
    share(TOK_WITHDRAWN, WITHDRAWN_UPLOAD),
  ],
});

let db: FakeDbState;

const call = async (
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  const { handler } = await import('../im-draft-portal');
  return handler({
    httpMethod: 'POST',
    path: `/api/im-draft/${route}`,
    body: JSON.stringify(body),
    headers,
    queryStringParameters: {},
  } as any);
};

const parse = (res: any) => JSON.parse(res.body);

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  db = freshDb();
  files = { [PATH]: PDF_BYTES };
  fake = createFakeSupabase({
    db,
    files,
    sessions: { 'good-session': { id: USER, email: 'pm@klarstein.com' } },
    rpc: {
      doc_rate_limit_hit: () => ({ data: true }),
      im_draft_check_code: (args) => ({ data: args.p_code === QM_CODE }),
    },
  });
});

// ---------------------------------------------------------------------------

describe('/file — Quality\'s review token', () => {
  it('serves the draft it was minted for', async () => {
    const res = await call('file', { uploadId: UPLOAD, token: TOK_OK });
    expect(res.statusCode).toBe(200);
    expect(parse(res).url).toBeTruthy();
    expect(fake.signedUrlCalls[0]).toMatchObject({ bucket: 'im-drafts', path: PATH, ttl: 300 });
  });

  it('REFUSES a design spec token pointed at a draft', async () => {
    // The claim the subject-equality check exists for. TOK_DESIGN_SPEC carries the right
    // subject_id and is live in every other respect — only subject_type differs.
    const res = await call('file', { uploadId: UPLOAD, token: TOK_DESIGN_SPEC });
    expect(res.statusCode).toBe(403);
    expect(parse(res).error).toBe(DEAD_LINK);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it("REFUSES another project's draft token", async () => {
    const res = await call('file', { uploadId: UPLOAD, token: TOK_OTHER_DRAFT });
    expect(res.statusCode).toBe(403);
    expect(parse(res).error).toBe(DEAD_LINK);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('refuses revoked, expired, view-mode, withdrawn and unknown tokens IDENTICALLY', async () => {
    // One message and one status for every case, so the endpoint is not an oracle.
    const cases: Array<[string, string]> = [
      [TOK_REVOKED, UPLOAD],
      [TOK_EXPIRED, UPLOAD],
      [TOK_VIEW, UPLOAD],
      [TOK_WITHDRAWN, WITHDRAWN_UPLOAD],
      ['no-such-token-at-all', UPLOAD],
    ];
    for (const [token, uploadId] of cases) {
      const res = await call('file', { uploadId, token });
      expect(res.statusCode, token).toBe(403);
      expect(parse(res).error, token).toBe(DEAD_LINK);
    }
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('does not reveal whether an unknown upload id exists', async () => {
    const res = await call('file', { uploadId: '00000000-0000-4000-8000-000000000000', token: TOK_OK });
    expect(res.statusCode).toBe(403);
    expect(parse(res).error).toBe(DEAD_LINK);
  });

  it('rejects a non-UUID upload id before touching the database', async () => {
    const res = await call('file', { uploadId: '../../etc/passwd', token: TOK_OK });
    expect(res.statusCode).toBe(400);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });
});

describe('/file — the other two credential branches', () => {
  it('serves a signed-in caller who can see the project', async () => {
    const res = await call('file', { uploadId: UPLOAD }, { authorization: 'Bearer good-session' });
    expect(res.statusCode).toBe(200);
  });

  it('401s a caller with no credential of any kind', async () => {
    const res = await call('file', { uploadId: UPLOAD });
    expect(res.statusCode).toBe(401);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('serves the supplier who uploaded it', async () => {
    const res = await call('file', { uploadId: UPLOAD }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(200);
  });

  it("refuses a supplier credential for a different project", async () => {
    const res = await call('file', { uploadId: UPLOAD }, { 'x-portal-token': OTHER_PROJECT_TOKEN });
    expect(res.statusCode).toBe(403);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });
});

describe('/requests and /upload-url — the supplier boundary', () => {
  it('lists only the requesting supplier\'s own open slots', async () => {
    const res = await call('requests', {}, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(200);
    const ids = parse(res).requests.map((r: any) => r.id);
    expect(ids).toContain(REQUEST);
    expect(ids).not.toContain(OTHER_REQUEST);      // another project's
    expect(ids).not.toContain(CANCELLED_REQUEST);  // cancelled
  });

  it('accepts the supplier-token + access-code credential too', async () => {
    const res = await call('requests', {}, {
      'x-supplier-token': SUPPLIER_TOKEN, 'x-supplier-code': ACCESS_CODE,
    });
    expect(res.statusCode).toBe(200);
    expect(parse(res).requests.map((r: any) => r.id)).toContain(REQUEST);
  });

  it('refuses a supplier token with the wrong access code', async () => {
    const res = await call('requests', {}, {
      'x-supplier-token': SUPPLIER_TOKEN, 'x-supplier-code': 'WRONG',
    });
    expect(parse(res).requests).toEqual([]);
  });

  it('401s with no portal credential at all', async () => {
    expect((await call('requests', {})).statusCode).toBe(401);
    expect((await call('upload-url', { requestId: REQUEST })).statusCode).toBe(401);
    expect((await call('commit', { requestId: REQUEST, uploadId: UPLOAD })).statusCode).toBe(401);
  });

  it("refuses an upload URL for another project's request", async () => {
    const res = await call('upload-url', { requestId: OTHER_REQUEST }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an upload URL for a cancelled request', async () => {
    const res = await call('upload-url', { requestId: CANCELLED_REQUEST }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(409);
  });

  it('mints a path the caller did not choose', async () => {
    const res = await call('upload-url', { requestId: REQUEST }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(200);
    const { uploadId, path } = parse(res);
    // The path is derived from ids the server controls, never from anything in the body.
    expect(path).toBe(`${REQUEST}/${uploadId}-draft.pdf`);
  });

  it('refuses an oversize declared file before any bytes move', async () => {
    const res = await call('upload-url', { requestId: REQUEST, byteSize: 60_000_000 }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(413);
  });
});

describe('/commit — byte validation', () => {
  const commit = (over: Record<string, unknown> = {}) =>
    call('commit', {
      requestId: REQUEST, uploadId: NEW_UPLOAD, uploadedByName: 'Supplier Sam',
      originalFilename: 'draft.pdf', ...over,
    }, { 'x-portal-token': PROJECT_TOKEN });

  const newPath = `${REQUEST}/${NEW_UPLOAD}-draft.pdf`;

  it('records a real PDF and opens Quality\'s review round bound to that upload', async () => {
    files[newPath] = PDF_BYTES;
    const res = await commit();
    expect(res.statusCode).toBe(200);

    const uploadInsert = fake.inserts.find(i => i.table === 'im_draft_uploads');
    expect(uploadInsert?.rows[0]).toMatchObject({
      id: NEW_UPLOAD, request_id: REQUEST, source: 'supplier',
      storage_path: newPath, uploaded_by_name: 'Supplier Sam',
    });
    // Read off the real bytes, not trusted from the client.
    expect(uploadInsert?.rows[0].byte_size).toBe(PDF_BYTES.byteLength);

    // The binding the whole security model rests on: subject_type + subject_id, so /file can
    // later prove a token belongs to THIS upload and nothing else.
    const shareInsert = fake.inserts.find(i => i.table === 'review_shares');
    expect(shareInsert?.rows[0]).toMatchObject({
      subject_type: 'im_draft', subject_id: NEW_UPLOAD, mode: 'review', project_id: PROJECT,
    });
    expect(shareInsert?.rows[0].expires_at).toBeTruthy();  // never a link that lives forever

    // NOT asserted here: the returned reviewToken. `review_shares.token` is filled by a
    // Postgres column DEFAULT (encode(gen_random_bytes(18), 'hex')), and this fake is not a
    // Postgres — it echoes back exactly the row that was inserted, so the default never
    // materialises. Asserting it would only prove the fake wrong. The token is exercised
    // end to end by the `netlify dev` walkthrough in the plan.
  });

  it('DELETES and refuses a file that is not a PDF', async () => {
    files[newPath] = NOT_PDF_BYTES;
    const res = await commit();
    expect(res.statusCode).toBe(400);
    expect(fake.removed.some(r => r.paths.includes(newPath))).toBe(true);
    expect(fake.inserts.some(i => i.table === 'im_draft_uploads')).toBe(false);
  });

  it('DELETES and refuses an empty file', async () => {
    files[newPath] = new Uint8Array(0);
    const res = await commit();
    expect(res.statusCode).toBe(400);
    expect(fake.removed.some(r => r.paths.includes(newPath))).toBe(true);
  });

  it('refuses when the upload never arrived', async () => {
    const res = await commit();   // nothing written to `files`
    expect(res.statusCode).toBe(400);
    expect(fake.inserts.some(i => i.table === 'im_draft_uploads')).toBe(false);
  });

  it('requires a name, so an upload is always attributable', async () => {
    files[newPath] = PDF_BYTES;
    const res = await commit({ uploadedByName: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a commit against another project's request", async () => {
    files[`${OTHER_REQUEST}/${NEW_UPLOAD}-draft.pdf`] = PDF_BYTES;
    const res = await call('commit', {
      requestId: OTHER_REQUEST, uploadId: NEW_UPLOAD, uploadedByName: 'Sam',
    }, { 'x-portal-token': PROJECT_TOKEN });
    expect(res.statusCode).toBe(403);
  });
});

describe('/queue — the QM access code', () => {
  it('refuses a wrong code without listing anything', async () => {
    const res = await call('queue', { code: 'nope' });
    expect(res.statusCode).toBe(403);
    expect(parse(res).drafts).toBeUndefined();
  });

  it('refuses a missing code', async () => {
    expect((await call('queue', {})).statusCode).toBe(403);
  });

  it('refuses once the rate limiter says stop, even with the RIGHT code', async () => {
    fake = createFakeSupabase({
      db, files,
      rpc: {
        doc_rate_limit_hit: () => ({ data: false }),
        im_draft_check_code: () => ({ data: true }),
      },
    });
    const res = await call('queue', { code: QM_CODE });
    expect(res.statusCode).toBe(403);
  });

  it('lists drafts awaiting review, and only those', async () => {
    const res = await call('queue', { code: QM_CODE });
    expect(res.statusCode).toBe(200);
    const tokens = parse(res).drafts.map((d: any) => d.token);
    expect(tokens).toContain(TOK_OK);
    expect(tokens).not.toContain(TOK_WITHDRAWN);  // the upload was withdrawn
    expect(tokens).not.toContain(TOK_EXPIRED);    // the link has expired
  });

  it('never returns a storage path', async () => {
    const res = await call('queue', { code: QM_CODE });
    expect(res.body).not.toContain('-draft.pdf');
  });
});

describe('routing', () => {
  it('refuses a method other than POST', async () => {
    const { handler } = await import('../im-draft-portal');
    const res = await handler({ httpMethod: 'GET', path: '/api/im-draft/queue', body: null, headers: {} } as any);
    expect(res.statusCode).toBe(405);
  });

  it('404s an unknown route rather than falling through to a real one', async () => {
    const res = await call('not-a-route', { code: QM_CODE });
    expect(res.statusCode).toBe(404);
  });
});
