/**
 * SOP & Documents — the security tests, run against the REAL handlers.
 *
 * Everything here goes through the actual `handler` export of doc-download.ts and
 * doc-portal.ts, with `createClient` swapped for an in-memory fake (lib/doc-fake-supabase).
 * Nothing in the entitlement path is stubbed: the same `resolveCaller`,
 * `loadEntitledVersion`, `supplierMaySeeVersion` and DTO code runs as in production.
 *
 * The three assertions the module was specified to make are the three `describe` blocks
 * at the top. The fixture deliberately gives every version a real `sharepoint_link` and a
 * real storage path, so "the response does not contain one" means the code removed it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeDbState, type FakeSupabase } from '../lib/doc-fake-supabase';

// ── ids ────────────────────────────────────────────────────────────────────────────────
const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const SUPPLIER_A = '33333333-3333-4333-8333-333333333333';
const SUPPLIER_B = '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b';
const DOC_INTERNAL = '44444444-4444-4444-8444-444444444444';
const DOC_SUPPLIER = '55555555-5555-4555-8555-555555555555';
const V_INTERNAL_FINAL = '66666666-6666-4666-8666-666666666666';
const V_SUPPLIER_FINAL = '77777777-7777-4777-8777-777777777777';
const V_SUPPLIER_DRAFT = '88888888-8888-4888-8888-888888888888';
const ADMIN_USER = '99999999-9999-4999-8999-999999999999';
const TEMPLATE_DEFAULT = 'a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601';

const PORTAL_TOKEN_A = 'portal-token-for-project-a';
const PORTAL_TOKEN_B = 'portal-token-for-project-b';
const SHAREPOINT = 'https://contoso.sharepoint.com/sites/plm/Live%20Editable.docx';

// ── the fake, wired in where the handlers build their client ───────────────────────────
let fake: FakeSupabase;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fake.client,
}));

const storagePath = (documentId: string, versionId: string) =>
  `docs/${documentId}/${versionId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;

const freshDb = (): FakeDbState => ({
  projects: [
    { id: PROJECT_A, supplier_id: SUPPLIER_A, supplier_link_token: PORTAL_TOKEN_A },
    { id: PROJECT_B, supplier_id: SUPPLIER_B, supplier_link_token: PORTAL_TOKEN_B },
  ],
  user_roles: [{ user_id: ADMIN_USER, role: 'admin' }],
  doc_documents: [
    {
      id: DOC_INTERNAL,
      title: 'Internal SOP — Supplier Escalation',
      doc_type: 'sop',
      audience: 'internal',
      owner_user_id: ADMIN_USER,
      tags: ['internal'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: DOC_SUPPLIER,
      title: 'Packaging Guideline',
      doc_type: 'guideline',
      audience: 'supplier',
      owner_user_id: ADMIN_USER,
      tags: ['packaging'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  doc_versions: [
    {
      id: V_INTERNAL_FINAL,
      document_id: DOC_INTERNAL,
      label: 'v2',
      is_final: true,
      finalized_by: ADMIN_USER,
      finalized_at: '2026-01-02T00:00:00Z',
      sharepoint_link: SHAREPOINT,
      pdf_storage_path: storagePath(DOC_INTERNAL, V_INTERNAL_FINAL),
      pdf_sha256: 'b'.repeat(64),
      pdf_bytes: 1000,
      superseded_by: null,
      uploaded_by: ADMIN_USER,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: V_SUPPLIER_FINAL,
      document_id: DOC_SUPPLIER,
      label: 'v4',
      is_final: true,
      finalized_by: ADMIN_USER,
      finalized_at: '2026-01-03T00:00:00Z',
      sharepoint_link: SHAREPOINT,
      pdf_storage_path: storagePath(DOC_SUPPLIER, V_SUPPLIER_FINAL),
      pdf_sha256: 'c'.repeat(64),
      pdf_bytes: 2000,
      superseded_by: null,
      uploaded_by: ADMIN_USER,
      created_at: '2026-01-02T00:00:00Z',
    },
    {
      id: V_SUPPLIER_DRAFT,
      document_id: DOC_SUPPLIER,
      label: 'v5 draft',
      is_final: false,
      finalized_by: null,
      finalized_at: null,
      sharepoint_link: SHAREPOINT,
      pdf_storage_path: storagePath(DOC_SUPPLIER, V_SUPPLIER_DRAFT),
      pdf_sha256: 'd'.repeat(64),
      pdf_bytes: 3000,
      superseded_by: null,
      uploaded_by: ADMIN_USER,
      created_at: '2026-01-04T00:00:00Z',
    },
  ],
  // BOTH documents are bound to project A. The internal one being bound is the whole
  // point: binding is not what makes something visible to a supplier, audience is.
  doc_bindings: [
    { id: 'b1', project_id: PROJECT_A, document_id: DOC_INTERNAL, created_by: ADMIN_USER, created_at: '2026-01-01T00:00:00Z' },
    { id: 'b2', project_id: PROJECT_A, document_id: DOC_SUPPLIER, created_by: ADMIN_USER, created_at: '2026-01-01T00:00:00Z' },
  ],
  doc_access_log: [],
  doc_download_tickets: [],
});

let db: FakeDbState;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.SUPABASE_ANON_KEY = 'anon-key';

  db = freshDb();
  fake = createFakeSupabase({
    db,
    sessions: { 'admin-jwt': { id: ADMIN_USER, email: 'admin@example.com' } },
    rpc: {
      doc_rate_limit_hit: () => ({ data: true }),
      // The real function is one atomic UPDATE ... RETURNING; this mirrors its contract:
      // returns the ticket exactly once, and only while unused and unexpired.
      doc_claim_download_ticket: ({ p_token }) => {
        const ticket = db.doc_download_tickets.find(
          t => t.token === p_token && !t.used_at && new Date(t.expires_at) > new Date(),
        );
        if (!ticket) return { data: null };
        ticket.used_at = new Date().toISOString();
        return { data: [{ ...ticket }] };
      },
      verify_supplier_access: ({ p_token, p_code }) =>
        p_token === 'supplier-token' && p_code === '123456'
          ? { data: [{ id: SUPPLIER_A }] }
          : { data: null },
    },
  });
});

// ── request builders ───────────────────────────────────────────────────────────────────
const supplierRequest = (path: string, token = PORTAL_TOKEN_A) => ({
  httpMethod: 'GET',
  body: null,
  path,
  headers: { 'x-portal-token': token },
  queryStringParameters: {},
});

const internalRequest = (path: string, query: Record<string, string> = {}) => ({
  httpMethod: 'GET',
  body: null,
  path,
  headers: { authorization: 'Bearer admin-jwt' },
  queryStringParameters: query,
});

const downloadPath = (versionId: string) => `/api/doc-versions/${versionId}/download`;

// Loaded after the mock is registered.
const download = async (event: any) => (await import('../doc-download')).handler(event as any);
const portal = async (event: any) => (await import('../doc-portal')).handler(event as any);

// =======================================================================================
// The three required assertions
// =======================================================================================

describe('a supplier token cannot read an internal document', () => {
  it('404s the download of a final version of an internal document', async () => {
    const res = await download(supplierRequest(downloadPath(V_INTERNAL_FINAL)));

    expect(res.statusCode).toBe(404);
    // 404, not 403: a supplier must not be able to tell an internal document from a
    // version id that does not exist.
    expect(res.statusCode).not.toBe(403);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('404s even though the internal document IS bound to the supplier project', async () => {
    expect(db.doc_bindings.some(b => b.document_id === DOC_INTERNAL && b.project_id === PROJECT_A)).toBe(true);
    const res = await download(supplierRequest(downloadPath(V_INTERNAL_FINAL)));
    expect(res.statusCode).toBe(404);
  });

  it('omits the internal document from the project document list entirely', async () => {
    const res = await portal(supplierRequest('/api/doc-portal/project-documents'));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].document.id).toBe(DOC_SUPPLIER);
    expect(res.body).not.toContain(DOC_INTERNAL);
    expect(res.body).not.toContain('Supplier Escalation');
  });

  it('404s the stable /latest route for an internal document', async () => {
    const res = await download(supplierRequest(`/api/documents/${DOC_INTERNAL}/latest`));
    expect(res.statusCode).toBe(404);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });
});

describe('a supplier token cannot read a non-final version', () => {
  it('404s the download of a draft version of a supplier-facing document', async () => {
    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_DRAFT)));

    expect(res.statusCode).toBe(404);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('never mentions the draft in the project document list', async () => {
    const res = await portal(supplierRequest('/api/doc-portal/project-documents'));

    expect(res.body).not.toContain(V_SUPPLIER_DRAFT);
    expect(res.body).not.toContain('v5 draft');
    // Not even a count: the supplier is told about the release, not about the pipeline.
    expect(JSON.parse(res.body).documents[0].finalVersion.id).toBe(V_SUPPLIER_FINAL);
  });

  it('drops a version out of supplier reach the moment it is un-finalised', async () => {
    // Serves fine while final...
    expect((await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)))).statusCode).toBe(302);

    // ...the un-finalise button does exactly this to the row.
    db.doc_versions.find(v => v.id === V_SUPPLIER_FINAL)!.is_final = false;

    expect((await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)))).statusCode).toBe(404);
    const list = await portal(supplierRequest('/api/doc-portal/project-documents'));
    expect(JSON.parse(list.body).documents).toHaveLength(0);
  });
});

describe('a supplier token cannot obtain a sharepoint_link', () => {
  it('returns no sharepoint link anywhere in the project document list', async () => {
    const res = await portal(supplierRequest('/api/doc-portal/project-documents'));

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('sharepoint');
    expect(res.body).not.toContain('contoso');
    expect(res.body).not.toContain('sharepointLink');
    // The fixture really does carry one, so the absence above is the code, not the data.
    expect(db.doc_versions.every(v => v.sharepoint_link === SHAREPOINT)).toBe(true);
  });

  it('returns no storage path or bucket name either', async () => {
    const res = await portal(supplierRequest('/api/doc-portal/project-documents'));

    expect(res.body).not.toContain('docs/');
    expect(res.body).not.toContain('sop-documents');
    expect(res.body).not.toContain('pdf_storage_path');
  });

  it('leaks nothing through the successful download response', async () => {
    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));

    expect(res.statusCode).toBe(302);
    expect(res.body).toBe('');
    expect(JSON.stringify(res.headers)).not.toContain('sharepoint');
    expect(JSON.stringify(res.headers)).not.toContain('docs/');
    // The Location header is the signed URL and nothing else.
    expect((res.headers as Record<string, string>).Location).toBe('https://storage.test/signed?token=abc');
  });

  it('does hand an internal caller the link — the split is real, not cosmetic', async () => {
    const res = await portal(internalRequest('/api/doc-portal/project-documents', { projectId: PROJECT_A }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('sharepointLink');
    expect(res.body).toContain('contoso');
  });
});

// =======================================================================================
// The rest of the boundary
// =======================================================================================

describe('credentials', () => {
  it('401s a request with no credentials at all', async () => {
    const res = await download({
      httpMethod: 'GET',
      body: null,
      path: downloadPath(V_SUPPLIER_FINAL),
      headers: {},
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(401);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('401s an unknown portal token', async () => {
    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL), 'not-a-real-token'));
    expect(res.statusCode).toBe(401);
  });

  it('401s an expired or invalid bearer token', async () => {
    const res = await download({
      httpMethod: 'GET',
      body: null,
      path: downloadPath(V_SUPPLIER_FINAL),
      headers: { authorization: 'Bearer stale-jwt' },
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('403s an authenticated user with no user_roles row — it never falls back to a default', async () => {
    fake = createFakeSupabase({
      db,
      sessions: { 'orphan-jwt': { id: '12121212-1212-4212-8212-121212121212' } },
      rpc: { doc_rate_limit_hit: () => ({ data: true }) },
    });

    const res = await download({
      httpMethod: 'GET',
      body: null,
      path: downloadPath(V_SUPPLIER_FINAL),
      headers: { authorization: 'Bearer orphan-jwt' },
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('ignores a role claimed in the token and reads user_roles instead', async () => {
    // The session says nothing about a role, and nothing in resolveCaller looks. The only
    // way this call becomes an admin is the user_roles row seeded above.
    db.user_roles = [{ user_id: ADMIN_USER, role: 'internal' }];
    const res = await portal(internalRequest('/api/doc-portal/project-documents', { projectId: PROJECT_A }));
    // 'internal' still sees everything on a project it can access...
    expect(res.statusCode).toBe(200);

    // ...but with no row at all, nothing.
    db.user_roles = [];
    const denied = await portal(internalRequest('/api/doc-portal/project-documents', { projectId: PROJECT_A }));
    expect(denied.statusCode).toBe(403);
  });
});

describe('project scoping', () => {
  it('404s a version bound only to another supplier project', async () => {
    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL), PORTAL_TOKEN_B));
    expect(res.statusCode).toBe(404);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('gives the other supplier an empty list rather than an error', async () => {
    const res = await portal(supplierRequest('/api/doc-portal/project-documents', PORTAL_TOKEN_B));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).documents).toEqual([]);
  });

  it('answers a supplier asking about a project they are not on the same way as an empty one', async () => {
    const res = await portal({
      httpMethod: 'GET',
      body: null,
      path: '/api/doc-portal/project-documents',
      headers: { 'x-portal-token': PORTAL_TOKEN_A },
      queryStringParameters: { projectId: PROJECT_B },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).documents).toEqual([]);
  });

  it('accepts a supplier token + access code and scopes it to that supplier only', async () => {
    const res = await portal({
      httpMethod: 'GET',
      body: null,
      path: '/api/doc-portal/project-documents',
      headers: { 'x-supplier-token': 'supplier-token', 'x-supplier-code': '123456' },
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).documents).toHaveLength(1);
  });

  it('401s a supplier token with the wrong access code', async () => {
    const res = await portal({
      httpMethod: 'GET',
      body: null,
      path: '/api/doc-portal/project-documents',
      headers: { 'x-supplier-token': 'supplier-token', 'x-supplier-code': '000000' },
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('the served download', () => {
  it('mints a 120-second signed URL and nothing longer', async () => {
    await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));

    expect(fake.signedUrlCalls).toHaveLength(1);
    expect(fake.signedUrlCalls[0].ttl).toBe(120);
    expect(fake.signedUrlCalls[0].bucket).toBe('sop-documents');
  });

  it('asks Storage for a friendly filename, which is where the real Content-Disposition comes from', async () => {
    await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));
    expect(fake.signedUrlCalls[0].options).toEqual({ download: 'Packaging-Guideline_v4.pdf' });
  });

  it('writes an access log row naming the supplier, not a user', async () => {
    await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));

    expect(db.doc_access_log).toHaveLength(1);
    expect(db.doc_access_log[0]).toMatchObject({
      version_id: V_SUPPLIER_FINAL,
      user_id: null,
      supplier_id: SUPPLIER_A,
    });
  });

  it('writes an access log row naming the user for an internal download', async () => {
    await download(internalRequest(downloadPath(V_INTERNAL_FINAL)));

    expect(db.doc_access_log).toHaveLength(1);
    expect(db.doc_access_log[0]).toMatchObject({
      version_id: V_INTERNAL_FINAL,
      user_id: ADMIN_USER,
      supplier_id: null,
    });
  });

  it('sets no-referrer and no-store so the signed URL cannot travel onward', async () => {
    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));
    expect((res.headers as Record<string, string>)['Referrer-Policy']).toBe('no-referrer');
    expect((res.headers as Record<string, string>)['Cache-Control']).toContain('no-store');
  });

  it('serves the internal document to an internal caller — they see everything', async () => {
    const res = await download(internalRequest(downloadPath(V_INTERNAL_FINAL)));
    expect(res.statusCode).toBe(302);
  });

  it('serves a non-final version to an internal caller', async () => {
    const res = await download(internalRequest(downloadPath(V_SUPPLIER_DRAFT)));
    expect(res.statusCode).toBe(302);
  });

  it('resolves /latest to the current final version', async () => {
    const res = await download(supplierRequest(`/api/documents/${DOC_SUPPLIER}/latest`));
    expect(res.statusCode).toBe(302);
    expect(fake.signedUrlCalls[0].path).toBe(storagePath(DOC_SUPPLIER, V_SUPPLIER_FINAL));
  });

  it('400s a version id that is not a uuid rather than querying with it', async () => {
    const res = await download(supplierRequest('/api/doc-versions/not-a-uuid/download'));
    expect(res.statusCode).toBe(400);
  });

  it('405s a non-GET download', async () => {
    const res = await download({ ...supplierRequest(downloadPath(V_SUPPLIER_FINAL)), httpMethod: 'POST' });
    expect(res.statusCode).toBe(405);
  });
});

describe('rate limiting', () => {
  it('429s once the shared window is exhausted, before signing anything', async () => {
    fake = createFakeSupabase({
      db,
      rpc: { doc_rate_limit_hit: () => ({ data: false }) },
    });

    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));
    expect(res.statusCode).toBe(429);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('keys the window per caller so one supplier cannot exhaust another', async () => {
    const keys: string[] = [];
    fake = createFakeSupabase({
      db,
      rpc: {
        doc_rate_limit_hit: ({ p_key }) => {
          keys.push(p_key);
          return { data: true };
        },
      },
    });

    await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL), PORTAL_TOKEN_A));
    await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL), PORTAL_TOKEN_B));

    expect(keys[0]).toBe(`doc-download:s:${SUPPLIER_A}`);
    expect(keys[1]).toBe(`doc-download:s:${SUPPLIER_B}`);
  });

  it('falls open rather than taking the module down when the limiter itself errors', async () => {
    fake = createFakeSupabase({
      db,
      rpc: { doc_rate_limit_hit: () => ({ error: { message: 'relation does not exist' } }) },
    });

    const res = await download(supplierRequest(downloadPath(V_SUPPLIER_FINAL)));
    expect(res.statusCode).toBe(302);
  });
});

describe('download tickets — how a browser navigation authenticates', () => {
  const mintTicket = async (versionId: string, token = PORTAL_TOKEN_A) =>
    portal({
      httpMethod: 'POST',
      body: JSON.stringify({ versionId }),
      path: '/api/doc-portal/download-ticket',
      headers: { 'x-portal-token': token },
      queryStringParameters: {},
    });

  const redeem = async (versionId: string, ticket: string) =>
    download({
      httpMethod: 'GET',
      body: null,
      path: downloadPath(versionId),
      headers: {},
      queryStringParameters: { ticket },
    });

  it('mints a ticket for a version the supplier may see', async () => {
    const res = await mintTicket(V_SUPPLIER_FINAL);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.url).toContain(`/api/doc-versions/${V_SUPPLIER_FINAL}/download?ticket=`);
    expect(body.expiresInSeconds).toBe(60);
    // Long enough not to be guessed.
    expect(body.ticket.length).toBeGreaterThanOrEqual(40);
  });

  it('refuses to mint a ticket for an internal document — no laundering a 404 into a credential', async () => {
    expect((await mintTicket(V_INTERNAL_FINAL)).statusCode).toBe(404);
    expect(db.doc_download_tickets).toHaveLength(0);
  });

  it('refuses to mint a ticket for a non-final version', async () => {
    expect((await mintTicket(V_SUPPLIER_DRAFT)).statusCode).toBe(404);
    expect(db.doc_download_tickets).toHaveLength(0);
  });

  it('redeems once, and only once', async () => {
    const { ticket } = JSON.parse((await mintTicket(V_SUPPLIER_FINAL)).body);

    expect((await redeem(V_SUPPLIER_FINAL, ticket)).statusCode).toBe(302);
    // A replayed link is dead, however it was obtained.
    expect((await redeem(V_SUPPLIER_FINAL, ticket)).statusCode).toBe(401);
    expect(fake.signedUrlCalls).toHaveLength(1);
  });

  it('cannot be redeemed against a different version', async () => {
    const { ticket } = JSON.parse((await mintTicket(V_SUPPLIER_FINAL)).body);

    const res = await redeem(V_INTERNAL_FINAL, ticket);
    expect(res.statusCode).toBe(401);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('is refused once expired', async () => {
    const { ticket } = JSON.parse((await mintTicket(V_SUPPLIER_FINAL)).body);
    db.doc_download_tickets[0].expires_at = new Date(Date.now() - 1000).toISOString();

    expect((await redeem(V_SUPPLIER_FINAL, ticket)).statusCode).toBe(401);
  });

  it('re-checks entitlement at redemption, not just at minting', async () => {
    const { ticket } = JSON.parse((await mintTicket(V_SUPPLIER_FINAL)).body);

    // An admin un-finalises in the seconds between the click and the navigation.
    db.doc_versions.find(v => v.id === V_SUPPLIER_FINAL)!.is_final = false;

    const res = await redeem(V_SUPPLIER_FINAL, ticket);
    expect(res.statusCode).toBe(404);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('re-checks the actor role at redemption too', async () => {
    const minted = await portal({
      httpMethod: 'POST',
      body: JSON.stringify({ versionId: V_INTERNAL_FINAL }),
      path: '/api/doc-portal/download-ticket',
      headers: { authorization: 'Bearer admin-jwt' },
      queryStringParameters: {},
    });
    expect(minted.statusCode).toBe(201);
    const { ticket } = JSON.parse(minted.body);

    // The account loses its role before the navigation lands.
    db.user_roles = [];

    expect((await redeem(V_INTERNAL_FINAL, ticket)).statusCode).toBe(403);
  });

  it('rejects a made-up ticket without touching storage', async () => {
    const res = await redeem(V_SUPPLIER_FINAL, 'x'.repeat(43));
    expect(res.statusCode).toBe(401);
    expect(fake.signedUrlCalls).toHaveLength(0);
  });

  it('rejects a ticket too short to be one of ours', async () => {
    expect((await redeem(V_SUPPLIER_FINAL, 'short')).statusCode).toBe(401);
  });
});

describe('the internal registry is not reachable by a supplier, and finalising is admin-only', () => {
  const registry = async (event: any) => (await import('../doc-registry')).handler(event as any);

  const asRole = (role: string) => {
    db.user_roles = [{ user_id: ADMIN_USER, role }];
  };

  const post = (path: string, body: unknown, headers: Record<string, string>) => ({
    httpMethod: 'POST',
    body: JSON.stringify(body),
    path,
    headers,
    queryStringParameters: {},
  });

  const asAdmin = { authorization: 'Bearer admin-jwt' };
  const asSupplier = { 'x-portal-token': PORTAL_TOKEN_A };

  it('403s a portal token on the registry list — there is no supplier path into this file', async () => {
    const res = await registry({
      httpMethod: 'GET',
      body: null,
      path: '/api/doc/documents',
      headers: asSupplier,
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s a portal token trying to finalise', async () => {
    const res = await registry(post(`/api/doc/versions/${V_SUPPLIER_DRAFT}/finalize`, {}, asSupplier));
    expect(res.statusCode).toBe(403);
  });

  it('403s an internal (non-admin) user trying to finalise', async () => {
    asRole('internal');
    const res = await registry(post(`/api/doc/versions/${V_SUPPLIER_DRAFT}/finalize`, {}, asAdmin));
    expect(res.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // The DESIGNER role (migration 163). resolveCaller resolves anything it does not
  // recognise as a SUPPLIER, so a role added to user_roles without being added to
  // INTERNAL_ROLES would silently hand that account the supplier-audience view of internal
  // documents instead of refusing it. These pin both halves: designer IS internal here,
  // and is still NOT an admin.
  // ---------------------------------------------------------------------------

  it('treats a designer as an internal caller, not as a supplier', async () => {
    asRole('designer');
    const res = await registry({
      httpMethod: 'GET',
      body: null,
      path: `/api/doc/documents/${DOC_SUPPLIER}/versions`,
      headers: asAdmin,
      queryStringParameters: {},
    });
    // A supplier-resolved caller is 403'd by this route outright; 200 is what proves the
    // designer came out of resolveCaller as internal.
    expect(res.statusCode).toBe(200);
  });

  it('403s a designer trying to finalise — internal is not admin', async () => {
    asRole('designer');
    const res = await registry(post(`/api/doc/versions/${V_SUPPLIER_DRAFT}/finalize`, {}, asAdmin));
    expect(res.statusCode).toBe(403);
  });

  it('403s a role nobody has taught this module about', async () => {
    // The fail-closed default that makes the two tests above worth having.
    asRole('marketing');
    const res = await registry({
      httpMethod: 'GET',
      body: null,
      path: '/api/doc/documents',
      headers: asAdmin,
      queryStringParameters: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('403s an internal (non-admin) user trying to UN-finalise', async () => {
    asRole('internal');
    const res = await registry(post(`/api/doc/versions/${V_SUPPLIER_FINAL}/unfinalize`, {}, asAdmin));
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin finalise, through the transactional database function', async () => {
    let called: Record<string, any> | null = null;
    fake = createFakeSupabase({
      db,
      sessions: { 'admin-jwt': { id: ADMIN_USER, email: 'admin@example.com' } },
      rpc: {
        doc_rate_limit_hit: () => ({ data: true }),
        // The handler must not do this as three separate statements — the atomicity is
        // the database's, and this asserts the handler delegates rather than reimplements.
        doc_finalize_version: args => {
          called = args;
          return { data: [{ ...db.doc_versions.find(v => v.id === args.p_version_id), is_final: true }] };
        },
      },
    });

    const res = await registry(post(`/api/doc/versions/${V_SUPPLIER_DRAFT}/finalize`, { note: 'approved' }, asAdmin));

    expect(res.statusCode).toBe(200);
    expect(called).toMatchObject({
      p_version_id: V_SUPPLIER_DRAFT,
      p_actor: ADMIN_USER,
      p_note: 'approved',
    });
  });

  it('lets an internal user read the registry, sharepoint links and all', async () => {
    asRole('internal');
    const res = await registry({
      httpMethod: 'GET',
      body: null,
      path: `/api/doc/documents/${DOC_SUPPLIER}/versions`,
      headers: asAdmin,
      queryStringParameters: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.versions).toHaveLength(2);
    expect(body.versions.some((v: any) => v.sharepointLink === SHAREPOINT)).toBe(true);
    // Still never the storage key, even for an admin.
    expect(res.body).not.toContain('docs/');
  });

  it('refuses a version registration pointing at another document\u2019s upload', async () => {
    const res = await registry(post(`/api/doc/documents/${DOC_SUPPLIER}/versions`, {
      versionId: V_SUPPLIER_DRAFT,
      // A key minted for the INTERNAL document, replayed against the supplier-facing one.
      storagePath: storagePath(DOC_INTERNAL, V_SUPPLIER_DRAFT),
      label: 'v6',
    }, asAdmin));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/does not belong to this document/i);
  });
});

// =======================================================================================
// Project-template document links (migration 166)
// =======================================================================================
//
// A template link is how a document reaches EVERY future project at once, so the gate on
// writing one is the interesting part: it is admin-only, a tier above binding a document
// to a single project, which any PM who can see that project may do.
//
// The stamping route is the other half -- createProject() calls it as the PM creating the
// project, so it must stay on the project gate rather than the admin one, or a PM could
// not create a project at all.

describe('project-template document links', () => {
  const registry = async (event: any) => (await import('../doc-registry')).handler(event as any);

  const asRole = (role: string) => {
    db.user_roles = [{ user_id: ADMIN_USER, role }];
  };

  const asAdmin = { authorization: 'Bearer admin-jwt' };
  const asSupplier = { 'x-portal-token': PORTAL_TOKEN_A };

  const templatePath = (documentId?: string) =>
    '/api/doc/templates/' + TEMPLATE_DEFAULT + '/documents' + (documentId ? '/' + documentId : '');

  const send = (httpMethod: string, path: string, body: unknown, headers: Record<string, string>) => ({
    httpMethod,
    body: body === null ? null : JSON.stringify(body),
    path,
    headers,
    queryStringParameters: {},
  });

  beforeEach(() => {
    db.project_templates = [{ id: TEMPLATE_DEFAULT, name: 'Standard Launch Process', is_default: true }];
    db.template_doc_bindings = [
      { id: 'tb1', template_id: TEMPLATE_DEFAULT, document_id: DOC_SUPPLIER, created_by: ADMIN_USER, created_at: '2026-01-01T00:00:00Z' },
    ];
  });

  // -- reading --------------------------------------------------------------------------

  it('403s a portal token reading a template’s documents', async () => {
    const res = await registry(send('GET', templatePath(), null, asSupplier));
    expect(res.statusCode).toBe(403);
  });

  it('lets an internal (non-admin) user read them, with the current release', async () => {
    asRole('internal');
    const res = await registry(send('GET', templatePath(), null, asAdmin));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].title).toBe('Packaging Guideline');
    // The whole point of a binding: the version is resolved at read time, not stored.
    expect(body.documents[0].finalVersion.label).toBe('v4');
    // A registry DTO, so still never the editable original or the storage key.
    expect(res.body).not.toContain(SHAREPOINT);
    expect(res.body).not.toContain('docs/');
  });

  // -- writing is admin-only ------------------------------------------------------------

  it('403s an internal (non-admin) user linking a document to a template', async () => {
    asRole('internal');
    const res = await registry(send('POST', templatePath(), { documentId: DOC_INTERNAL }, asAdmin));

    expect(res.statusCode).toBe(403);
    expect(db.template_doc_bindings).toHaveLength(1);
  });

  it('403s a designer linking one, because internal is not admin here either', async () => {
    asRole('designer');
    const res = await registry(send('POST', templatePath(), { documentId: DOC_INTERNAL }, asAdmin));
    expect(res.statusCode).toBe(403);
  });

  it('403s an internal (non-admin) user unlinking one', async () => {
    asRole('internal');
    const res = await registry(send('DELETE', templatePath(DOC_SUPPLIER), null, asAdmin));

    expect(res.statusCode).toBe(403);
    expect(db.template_doc_bindings).toHaveLength(1);
  });

  it('403s a portal token linking one', async () => {
    const res = await registry(send('POST', templatePath(), { documentId: DOC_INTERNAL }, asSupplier));
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin link a document to a template', async () => {
    const res = await registry(send('POST', templatePath(), { documentId: DOC_INTERNAL }, asAdmin));

    expect(res.statusCode).toBe(201);
    expect(db.template_doc_bindings.some(r => r.document_id === DOC_INTERNAL)).toBe(true);
  });

  it('rejects a non-uuid documentId before touching the table', async () => {
    const res = await registry(send('POST', templatePath(), { documentId: 'packaging-guidelines' }, asAdmin));

    expect(res.statusCode).toBe(400);
    expect(db.template_doc_bindings).toHaveLength(1);
  });

  // -- stamping a project ---------------------------------------------------------------

  it('binds the default template documents to a project', async () => {
    db.doc_bindings = [];
    const res = await registry(send('POST', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', {}, asAdmin));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).bound).toBe(1);
    expect(db.doc_bindings.map(b => b.document_id)).toEqual([DOC_SUPPLIER]);
  });

  it('resolves the default template when none is named', async () => {
    // What the "Apply standard documents" path relies on: the browser cannot read
    // template_doc_bindings at all, so it cannot name a template either.
    db.doc_bindings = [];
    const res = await registry(send('POST', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', { templateId: null }, asAdmin));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).bound).toBe(1);
  });

  it('reports zero rather than failing when no template is the default', async () => {
    // createProject() must not break because an admin has not marked a default yet.
    db.project_templates = [{ id: TEMPLATE_DEFAULT, name: 'Standard Launch Process', is_default: false }];
    db.doc_bindings = [];

    const res = await registry(send('POST', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', {}, asAdmin));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).bound).toBe(0);
    expect(db.doc_bindings).toHaveLength(0);
  });

  it('reports zero when the template hands nothing down', async () => {
    db.template_doc_bindings = [];
    db.doc_bindings = [];

    const res = await registry(send('POST', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', {}, asAdmin));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).bound).toBe(0);
  });

  it('403s a portal token trying to stamp a project', async () => {
    const res = await registry(send('POST', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', {}, asSupplier));
    expect(res.statusCode).toBe(403);
  });

  it('does not read from-template as a document id on the DELETE route', async () => {
    // The literal segment sits where deleteBinding expects a uuid. Asserting the 400 pins
    // the router ordering that keeps POST .../from-template from ever reaching it.
    const res = await registry(send('DELETE', '/api/doc/projects/' + PROJECT_A + '/bindings/from-template', null, asAdmin));
    expect(res.statusCode).toBe(400);
  });
});
