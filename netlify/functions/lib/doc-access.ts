/**
 * SOP & Documents — the shared authorization, entitlement and DTO layer.
 *
 * Every doc_* route (doc-registry, doc-portal, doc-download) goes through this file. It
 * exists so that the three security decisions this module makes are made ONCE:
 *
 *   1. WHO IS CALLING           — `resolveCaller`
 *   2. MAY THEY SEE THIS VERSION — `supplierMaySeeVersion` / `loadEntitledVersion`
 *   3. WHAT MAY THEY BE TOLD    — `toSupplierVersionDto` and friends
 *
 * A route that answers any of those itself is a route that can drift from the others, and
 * the whole point of the module is that a supplier can never be told a sharepoint_link.
 *
 * ROLES COME FROM public.user_roles, NEVER FROM THE JWT
 * -----------------------------------------------------
 * `supabase.auth.getUser(token)` returns a user object carrying `user_metadata` and
 * `app_metadata`. `user_metadata` is writable BY THE USER through auth.updateUser(), so a
 * role read from it is a role the caller granted themselves. `resolveCaller` therefore
 * uses the token for one thing only — establishing WHICH user this is — and then reads
 * the role from the database.
 *
 * SUPPLIERS ARE NOT AUTHENTICATED USERS
 * --------------------------------------
 * In OriginFlow a supplier is `anon` holding a portal credential, exactly as in
 * supplier-file-url.ts: either a project token (projects.supplier_link_token) or a
 * supplier token + access code (verified by the verify_supplier_access RPC, which owns
 * the brute-force lockout). Both resolve to a supplier id and the set of projects that
 * supplier is on — which is what the visibility rule is written in terms of.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — doc_* is unreachable without it (RLS default-deny)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { NetlifyEvent } from './http';

// ===========================================================================
// Constants
// ===========================================================================

/** Private bucket created by migration 159. Never made public, never given an RLS policy. */
export const DOC_BUCKET = 'sop-documents';

/**
 * 120 seconds, per the module's security requirements. Long enough for a browser to
 * follow one redirect and start the transfer, short enough that a URL copied out of a
 * network log is dead before it can be pasted anywhere useful.
 */
export const SIGNED_URL_TTL_SECONDS = 120;

/** Mirrors storage.buckets.file_size_limit for `sop-documents` in migration 159. */
export const MAX_PDF_BYTES = 26214400; // 25 MB

export const DOC_TYPES = ['sop', 'guideline', 'spec', 'template', 'form', 'checklist'] as const;
export const AUDIENCES = ['internal', 'supplier'] as const;

export type DocType = (typeof DOC_TYPES)[number];
export type Audience = (typeof AUDIENCES)[number];

// ===========================================================================
// Errors — mapped to status codes by `handleDocError` at the bottom
// ===========================================================================

export class DocAuthError extends Error {}        // 401
export class DocForbiddenError extends Error {}   // 403
export class DocNotFoundError extends Error {}    // 404
export class DocValidationError extends Error {}  // 400
export class DocRateLimitError extends Error {}   // 429

// ===========================================================================
// Rows (the shape we read out of Postgres) and DTOs (the shape we hand out)
// ===========================================================================

export interface DocumentRow {
  id: string;
  title: string;
  doc_type: string;
  audience: string;
  owner_user_id: string;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  document_id: string;
  label: string;
  is_final: boolean;
  finalized_by: string | null;
  finalized_at: string | null;
  sharepoint_link: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  pdf_bytes: number | null;
  superseded_by: string | null;
  uploaded_by: string;
  created_at: string;
}

/**
 * The columns each route selects. Written out rather than `select('*')` so that adding a
 * column to doc_versions later cannot silently start including it in a response — the
 * DTO whitelists below are the second guard, this is the first.
 */
export const DOCUMENT_COLUMNS =
  'id, title, doc_type, audience, owner_user_id, tags, created_at, updated_at';
export const VERSION_COLUMNS =
  'id, document_id, label, is_final, finalized_by, finalized_at, sharepoint_link, ' +
  'pdf_storage_path, pdf_sha256, pdf_bytes, superseded_by, uploaded_by, created_at';

// ===========================================================================
// Callers
// ===========================================================================

/**
 * Every `user_roles.role` that counts as an internal user of this module.
 *
 * ONE list, consulted by both resolution paths below, because the failure mode of having
 * two is silent and bad: anything not in it is resolved as a SUPPLIER, so a role added to
 * `user_roles` (migration 163 added 'designer') but forgotten here would hand that account
 * the supplier-audience view of internal documents rather than refusing it. Add new role
 * values here and in `doc_role_from_profile` together.
 *
 * Note 'designer' is internal but NOT admin: `requireAdmin` still refuses it, so a designer
 * cannot finalise or un-finalise an SOP. They own Design Specs, not this registry.
 */
export const INTERNAL_ROLES = ['admin', 'internal', 'designer'] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

export const isInternalRole = (role: string | null): role is InternalRole =>
  role !== null && (INTERNAL_ROLES as readonly string[]).includes(role);

/**
 * An authenticated OriginFlow user. `role` is read from public.user_roles, never from the
 * token. 'internal' and 'designer' see every document and every version; 'admin'
 * additionally may finalise, un-finalise and manage the registry.
 */
export interface InternalCaller {
  kind: 'internal';
  role: InternalRole;
  userId: string;
  email: string | null;
}

/**
 * A supplier reached through a portal credential. `projectIds` is the complete set of
 * projects this credential speaks for — the visibility rule is evaluated against exactly
 * this set and nothing else.
 */
export interface SupplierCaller {
  kind: 'supplier';
  supplierId: string;
  projectIds: string[];
}

export type Caller = InternalCaller | SupplierCaller;

export const isInternal = (c: Caller): c is InternalCaller => c.kind === 'internal';
export const isAdmin = (c: Caller): boolean => c.kind === 'internal' && c.role === 'admin';

/** Throws unless the caller is an admin. The single gate for finalise / un-finalise. */
export const requireAdmin = (caller: Caller): InternalCaller => {
  if (!isInternal(caller) || caller.role !== 'admin') {
    throw new DocForbiddenError('Only an administrator can do this.');
  }
  return caller;
};

/** Throws unless the caller is an authenticated internal user (admin counts). */
export const requireInternal = (caller: Caller): InternalCaller => {
  if (!isInternal(caller)) {
    throw new DocForbiddenError('This is an internal-only endpoint.');
  }
  return caller;
};

// ===========================================================================
// Credential extraction
// ===========================================================================

const header = (event: NetlifyEvent, name: string): string => {
  const h = event.headers || {};
  // Netlify lowercases incoming header names, but a local `netlify dev` proxy and the
  // test harness do not always; check both rather than depend on it.
  const value = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
  return typeof value === 'string' ? value.trim() : '';
};

const bearerToken = (event: NetlifyEvent): string =>
  header(event, 'authorization').replace(/^Bearer\s+/i, '').trim();

/**
 * Portal credentials travel in HEADERS, not the query string.
 *
 * A query string ends up in access logs, in `Referer` on any outbound link the page
 * renders, and in a shared or bookmarked URL. The supplier's project token is already in
 * their address bar (/#/supplier/:token) so it is not a new secret, but the supplier
 * ACCESS CODE is — putting it in a URL would leak a credential that today only ever
 * travels in a POST body.
 */
const portalCredentials = (event: NetlifyEvent) => ({
  projectToken: header(event, 'x-portal-token'),
  supplierToken: header(event, 'x-supplier-token'),
  accessCode: header(event, 'x-supplier-code'),
});

/** Best-effort client IP for doc_access_log. Netlify sets x-nf-client-connection-ip. */
export const clientIp = (event: NetlifyEvent): string | null =>
  header(event, 'x-nf-client-connection-ip') ||
  header(event, 'x-forwarded-for').split(',')[0].trim() ||
  null;

// ===========================================================================
// resolveCaller
// ===========================================================================

/**
 * Establish who is calling, or throw.
 *
 * Order matters: a bearer token wins, because an internal user's session is the stronger
 * claim and we never want a stray portal header to downgrade an admin to a supplier.
 *
 * @param supabase MUST be the service-role client — user_roles, projects and suppliers
 *                 are all unreadable to anon by design.
 */
export const resolveCaller = async (
  event: NetlifyEvent,
  supabase: SupabaseClient,
): Promise<Caller> => {
  const token = bearerToken(event);
  if (token) return resolveAuthenticatedCaller(token, supabase);

  const { projectToken, supplierToken, accessCode } = portalCredentials(event);
  if (projectToken) return resolveProjectTokenCaller(projectToken, supabase);
  if (supplierToken && accessCode) return resolveSupplierTokenCaller(supplierToken, accessCode, supabase);

  throw new DocAuthError('Authentication required.');
};

const resolveAuthenticatedCaller = async (
  token: string,
  supabase: SupabaseClient,
): Promise<Caller> => {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new DocAuthError('Invalid or expired session.');

  const userId = data.user.id;

  // THE ROLE LOOKUP. Note what is deliberately not used: data.user.user_metadata,
  // data.user.app_metadata, and anything else that travelled inside the token.
  const { data: roleRow, error: roleErr } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();

  if (roleErr) {
    console.error('[doc-access] user_roles lookup failed:', roleErr);
    throw new Error('Could not verify your access level.');
  }
  // Fail closed. A user with no user_roles row is not "probably internal" — migration 159
  // seeds every existing profile and a trigger keeps it current, so a missing row means
  // something is wrong, and the safe reading of "something is wrong" is "no access".
  if (!roleRow) throw new DocForbiddenError('Your account has no role assigned.');

  const role = String((roleRow as { role: string }).role);

  if (isInternalRole(role)) {
    return { kind: 'internal', role, userId, email: data.user.email ?? null };
  }

  // role === 'supplier': an authenticated account flagged as a supplier. OriginFlow has
  // no supplier LOGIN today (suppliers use portal tokens), and nothing in the schema maps
  // an auth.users row to a suppliers row — so there is no honest way to decide which
  // projects such an account speaks for. Refusing is the only fail-closed answer; when
  // supplier logins arrive, the user -> supplier mapping belongs right here.
  throw new DocForbiddenError('Supplier accounts must use their project portal link.');
};

const resolveProjectTokenCaller = async (
  projectToken: string,
  supabase: SupabaseClient,
): Promise<SupplierCaller> => {
  const { data: project, error } = await supabase
    .from('projects')
    .select('id, supplier_id')
    .eq('supplier_link_token', projectToken)
    .maybeSingle();

  if (error) {
    console.error('[doc-access] project token lookup failed:', error);
    throw new Error('Could not verify the portal link.');
  }
  if (!project) throw new DocAuthError('This portal link is not valid.');

  const supplierId = (project as { supplier_id: string | null }).supplier_id;
  // Documents are served TO A SUPPLIER and every download is recorded against one
  // (doc_access_log requires an actor). A project with nobody assigned has no supplier to
  // serve or to record, so there is nothing coherent to do but refuse.
  if (!supplierId) {
    throw new DocForbiddenError('This project has no supplier assigned.');
  }

  return { kind: 'supplier', supplierId, projectIds: [(project as { id: string }).id] };
};

const resolveSupplierTokenCaller = async (
  supplierToken: string,
  accessCode: string,
  supabase: SupabaseClient,
): Promise<SupplierCaller> => {
  // Deliberately the same RPC the SPA uses (supplier.service.ts). It compares the code in
  // the database and owns the brute-force lockout in portal_access_attempts; a second
  // comparison written here would be a second, un-rate-limited way in.
  const { data, error } = await supabase.rpc('verify_supplier_access', {
    p_token: supplierToken,
    p_code: accessCode,
  });

  if (error) {
    // The lockout surfaces as an RPC error. Pass it through as 403 rather than 500 —
    // "too many attempts" is a decision, not a fault.
    throw new DocForbiddenError('This supplier link or access code is not valid.');
  }

  const row = Array.isArray(data) ? data[0] : data;
  const supplierId = row && typeof row === 'object' ? (row as { id?: string }).id : undefined;
  if (!supplierId) throw new DocAuthError('This supplier link or access code is not valid.');

  const { data: projects, error: projErr } = await supabase
    .from('projects')
    .select('id')
    .eq('supplier_id', supplierId);

  if (projErr) {
    console.error('[doc-access] supplier project list failed:', projErr);
    throw new Error('Could not load your projects.');
  }

  return {
    kind: 'supplier',
    supplierId,
    projectIds: (projects || []).map((p: { id: string }) => p.id),
  };
};

/**
 * Rebuild a caller from a claimed download ticket.
 *
 * A ticket says WHO, never WHAT: the download route re-runs the entitlement check with
 * the caller this returns, so a ticket minted 30 seconds before an admin un-finalised the
 * version is refused on use. Nothing here consults the ticket's version_id for
 * authorization — that field exists so a ticket for one document cannot be redeemed
 * against another, which the route checks separately.
 */
export const callerFromTicket = async (
  supabase: SupabaseClient,
  ticket: { user_id: string | null; supplier_id: string | null },
): Promise<Caller> => {
  if (ticket.user_id) {
    const { data: roleRow, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', ticket.user_id)
      .maybeSingle();

    if (error) {
      console.error('[doc-access] ticket role lookup failed:', error);
      throw new Error('Could not verify your access level.');
    }
    const role = roleRow ? String((roleRow as { role: string }).role) : null;
    // The role is re-read now, not trusted from when the ticket was minted: an account
    // demoted in the meantime is demoted for this download too.
    if (!isInternalRole(role)) {
      throw new DocForbiddenError('Your account has no role assigned.');
    }
    return { kind: 'internal', role, userId: ticket.user_id, email: null };
  }

  if (ticket.supplier_id) {
    const { data: projects, error } = await supabase
      .from('projects')
      .select('id')
      .eq('supplier_id', ticket.supplier_id);

    if (error) {
      console.error('[doc-access] ticket project lookup failed:', error);
      throw new Error('Could not load your projects.');
    }
    return {
      kind: 'supplier',
      supplierId: ticket.supplier_id,
      // Re-derived, so a project reassigned away from this supplier since the ticket was
      // minted is no longer in scope.
      projectIds: (projects || []).map((p: { id: string }) => p.id),
    };
  }

  throw new DocAuthError('This download link is not valid.');
};

// ===========================================================================
// The visibility rule
// ===========================================================================

/**
 * THE rule, in one place, as a pure function:
 *
 *   a supplier sees a version iff
 *     is_final = true
 *     AND doc_documents.audience = 'supplier'
 *     AND a doc_bindings row links the document to a project that supplier is on.
 *
 * Pure and exported so it can be tested exhaustively without a database — the three
 * clauses are the three things that must never be got wrong, and each of them fails
 * independently. Callers pass `boundProjectIds` = the project ids bound to this document.
 */
export const supplierMaySeeVersion = (params: {
  document: Pick<DocumentRow, 'audience'>;
  version: Pick<VersionRow, 'is_final'>;
  boundProjectIds: readonly string[];
  supplierProjectIds: readonly string[];
}): boolean => {
  const { document, version, boundProjectIds, supplierProjectIds } = params;
  if (!version.is_final) return false;
  if (document.audience !== 'supplier') return false;
  if (supplierProjectIds.length === 0) return false;
  const supplierSet = new Set(supplierProjectIds);
  return boundProjectIds.some(id => supplierSet.has(id));
};

/**
 * Load a version and decide whether this caller is entitled to it — the check the
 * download route runs before it will mint a signed URL.
 *
 * Internal callers see every version of every document, final or not. Supplier callers go
 * through `supplierMaySeeVersion`.
 *
 * A caller who is not entitled gets 404, not 403: to a supplier, an internal document
 * must be indistinguishable from a version id that does not exist. A 403 would confirm
 * that some document has that id, which is the one bit an id-probing caller wants.
 */
export const loadEntitledVersion = async (
  supabase: SupabaseClient,
  versionId: string,
  caller: Caller,
): Promise<{ version: VersionRow; document: DocumentRow }> => {
  const { data: version, error } = await supabase
    .from('doc_versions')
    .select(VERSION_COLUMNS)
    .eq('id', versionId)
    .maybeSingle();

  if (error) {
    console.error('[doc-access] version lookup failed:', error);
    throw new Error('Could not load this document version.');
  }
  if (!version) throw new DocNotFoundError('No such document version.');

  const row = version as unknown as VersionRow;

  const { data: document, error: docErr } = await supabase
    .from('doc_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', row.document_id)
    .maybeSingle();

  if (docErr || !document) throw new DocNotFoundError('No such document version.');
  const doc = document as unknown as DocumentRow;

  if (isInternal(caller)) return { version: row, document: doc };

  const boundProjectIds = await bindingProjectIds(supabase, doc.id);
  const allowed = supplierMaySeeVersion({
    document: doc,
    version: row,
    boundProjectIds,
    supplierProjectIds: caller.projectIds,
  });
  if (!allowed) throw new DocNotFoundError('No such document version.');

  return { version: row, document: doc };
};

/** The project ids a document is bound to. */
export const bindingProjectIds = async (
  supabase: SupabaseClient,
  documentId: string,
): Promise<string[]> => {
  const { data, error } = await supabase
    .from('doc_bindings')
    .select('project_id')
    .eq('document_id', documentId);
  if (error) {
    console.error('[doc-access] binding lookup failed:', error);
    throw new Error('Could not check which projects this document applies to.');
  }
  return (data || []).map((b: { project_id: string }) => b.project_id);
};

// ===========================================================================
// DTOs — every field written out by hand
// ===========================================================================
//
// NOT `{ ...row }`, not `omit(row, ['sharepoint_link'])`, not a denylist of any kind. A
// denylist is only correct until the next column is added; a whitelist is correct by
// construction, and the failure mode of forgetting to add a field to it is a missing
// field in the UI rather than a leaked SharePoint link.
//
// `pdf_storage_path` is absent from EVERY DTO below, internal ones included. A storage
// key is not useful to a client that cannot read the bucket, and handing it out turns a
// future misconfigured storage policy from "nothing happens" into "everyone already knows
// the keys".

export interface SupplierDocumentDto {
  id: string;
  title: string;
  docType: string;
  tags: string[];
}

export interface SupplierVersionDto {
  id: string;
  documentId: string;
  label: string;
  finalizedAt: string | null;
  pdfBytes: number | null;
  pdfSha256: string | null;
  /** The route to hit for the bytes. Not a storage URL, and not signed — see doc-download. */
  downloadPath: string;
}

export interface InternalDocumentDto extends SupplierDocumentDto {
  audience: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface InternalVersionDto {
  id: string;
  documentId: string;
  label: string;
  isFinal: boolean;
  finalizedBy: string | null;
  finalizedAt: string | null;
  /** INTERNAL ONLY. The one field whose presence here and absence above is the whole point. */
  sharepointLink: string | null;
  hasPdf: boolean;
  pdfBytes: number | null;
  pdfSha256: string | null;
  supersededBy: string | null;
  uploadedBy: string;
  createdAt: string;
  downloadPath: string;
}

export const toSupplierDocumentDto = (row: DocumentRow): SupplierDocumentDto => ({
  id: row.id,
  title: row.title,
  docType: row.doc_type,
  tags: row.tags || [],
});

export const toSupplierVersionDto = (row: VersionRow): SupplierVersionDto => ({
  id: row.id,
  documentId: row.document_id,
  label: row.label,
  finalizedAt: row.finalized_at,
  pdfBytes: row.pdf_bytes,
  pdfSha256: row.pdf_sha256,
  downloadPath: `/api/doc-versions/${row.id}/download`,
});

export const toInternalDocumentDto = (row: DocumentRow): InternalDocumentDto => ({
  ...toSupplierDocumentDto(row),
  audience: row.audience,
  ownerUserId: row.owner_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toInternalVersionDto = (row: VersionRow): InternalVersionDto => ({
  id: row.id,
  documentId: row.document_id,
  label: row.label,
  isFinal: row.is_final,
  finalizedBy: row.finalized_by,
  finalizedAt: row.finalized_at,
  sharepointLink: row.sharepoint_link,
  hasPdf: row.pdf_storage_path != null,
  pdfBytes: row.pdf_bytes,
  pdfSha256: row.pdf_sha256,
  supersededBy: row.superseded_by,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
  downloadPath: `/api/doc-versions/${row.id}/download`,
});

/** Picks the right DTO for the caller. Routes should use this rather than choosing. */
export const toVersionDto = (row: VersionRow, caller: Caller): InternalVersionDto | SupplierVersionDto =>
  isInternal(caller) ? toInternalVersionDto(row) : toSupplierVersionDto(row);

export const toDocumentDto = (row: DocumentRow, caller: Caller): InternalDocumentDto | SupplierDocumentDto =>
  isInternal(caller) ? toInternalDocumentDto(row) : toSupplierDocumentDto(row);

// ===========================================================================
// Upload validation
// ===========================================================================

/**
 * The released file must actually be a PDF. Extensions and Content-Type are both supplied
 * by the caller and neither says anything about the bytes — a .pdf that is really an HTML
 * page would be served back, from our origin, to whoever downloads it next.
 *
 * `%PDF-` at offset 0, per ISO 32000. Strict about the offset: some readers tolerate
 * leading junk, but this is a RELEASED document and a file that does not start with the
 * header is not one somebody meant to release.
 */
export const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 && // %
  bytes[1] === 0x50 && // P
  bytes[2] === 0x44 && // D
  bytes[3] === 0x46 && // F
  bytes[4] === 0x2d;   // -

/**
 * A filename a person can find again in their Downloads folder, derived from the document
 * title and the version label.
 *
 * Everything outside [A-Za-z0-9._-] becomes a hyphen. That is not cosmetic: this string
 * goes into a Content-Disposition header, where an unescaped quote or newline is a header
 * injection, and titles here are free text typed by users.
 */
export const friendlyFilename = (title: string, label: string): string => {
  const clean = (s: string) =>
    s.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const base = [clean(title) || 'document', clean(label)].filter(Boolean).join('_');
  return `${base}.pdf`;
};

/**
 * The storage key for a released PDF: docs/{document_id}/{version_id}/{random uuid}.pdf.
 *
 * Never derived from the title or the label. Two reasons: a key derived from a title is
 * guessable from the registry listing (and this bucket's whole defence is that nothing
 * outside the download route knows a key), and two versions labelled "v4" a year apart
 * would collide and silently overwrite a released document.
 */
export const versionStorageKey = (documentId: string, versionId: string, random: string): string =>
  `docs/${documentId}/${versionId}/${random}.pdf`;

/**
 * A key we minted, and not one a caller made up. Checked before the server will attach a
 * path to a version row, so a caller cannot point a version at another document's object
 * by posting its key.
 */
export const isOwnedStorageKey = (key: string, documentId: string, versionId: string): boolean =>
  new RegExp(
    `^docs/${documentId}/${versionId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`,
  ).test(key);

// ===========================================================================
// Rate limiting
// ===========================================================================

/**
 * One fixed window in Postgres (migration 159). Throws `DocRateLimitError` (429) when the
 * window is exhausted.
 *
 * FAILS OPEN, on purpose and narrowly: if the limiter itself errors, the request is
 * allowed. The routes it guards are already authenticated and entitlement-checked, so the
 * limiter is protecting against volume, not against access — and taking the module down
 * because a counter table is unhappy trades a small risk for a certain outage.
 */
export const rateLimit = async (
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<void> => {
  const { data, error } = await supabase.rpc('doc_rate_limit_hit', {
    p_key: key,
    p_limit: limit,
    p_window_s: windowSeconds,
  });
  if (error) {
    console.error('[doc-access] rate limiter unavailable, allowing request:', error);
    return;
  }
  if (data === false) throw new DocRateLimitError('Too many requests. Please wait a moment.');
};

/** A stable, non-identifying key for the caller, so one supplier cannot exhaust another's budget. */
export const rateLimitKey = (route: string, caller: Caller): string =>
  caller.kind === 'internal' ? `${route}:u:${caller.userId}` : `${route}:s:${caller.supplierId}`;

// ===========================================================================
// Error -> response
// ===========================================================================

/**
 * The single place a thrown error becomes a status code. Unknown errors become 500 with a
 * generic message and are logged server-side — a Postgres error string can name tables,
 * columns and constraints, and none of that belongs in a supplier's browser.
 */
export const handleDocError = (
  e: unknown,
): { statusCode: number; headers: Record<string, string>; body: string } => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const send = (statusCode: number, error: string) => ({
    statusCode,
    headers,
    body: JSON.stringify({ error }),
  });

  if (e instanceof DocAuthError) return send(401, e.message);
  if (e instanceof DocForbiddenError) return send(403, e.message);
  if (e instanceof DocNotFoundError) return send(404, e.message);
  if (e instanceof DocValidationError) return send(400, e.message);
  if (e instanceof DocRateLimitError) return send(429, e.message);

  console.error('[doc-access] unhandled error:', e);
  return send(500, 'Something went wrong. Please try again.');
};

/** JSON response helper with the no-store the whole module needs. */
export const docJson = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

// ===========================================================================
// Small validators
// ===========================================================================

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const assertDocUuid = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new DocValidationError(`${name} must be a UUID.`);
  }
  return value;
};

export const assertText = (value: unknown, name: string, maxLength = 300): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DocValidationError(`${name} is required.`);
  }
  if (value.length > maxLength) {
    throw new DocValidationError(`${name} must be ${maxLength} characters or fewer.`);
  }
  return value.trim();
};

export const assertEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DocValidationError(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
};

/**
 * The SharePoint link, or null. Restricted to http(s) so the stored value can never be a
 * `javascript:` URL that an internal user's browser would run when the admin UI renders
 * it as an anchor.
 */
export const assertOptionalLink = (value: unknown, name: string): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) {
    throw new DocValidationError(`${name} must be a URL of 2000 characters or fewer.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DocValidationError(`${name} must be a valid URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new DocValidationError(`${name} must be an http(s) URL.`);
  }
  return value;
};

export const assertTags = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new DocValidationError('tags must be an array of strings.');
  if (value.length > 25) throw new DocValidationError('A document can carry at most 25 tags.');
  return value.map(t => {
    if (typeof t !== 'string' || t.trim().length === 0 || t.length > 60) {
      throw new DocValidationError('Each tag must be a non-empty string of 60 characters or fewer.');
    }
    return t.trim();
  });
};
