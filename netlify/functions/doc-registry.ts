/**
 * SOP & Documents — the internal registry API (Netlify Function).
 *
 * Every route below is served under /api/doc/* (see netlify.toml) and every one of them
 * requires an AUTHENTICATED INTERNAL USER. There is no portal-token path into this file
 * at all: a supplier's entire surface is doc-portal.ts (list) and doc-download.ts (bytes).
 *
 *   GET    /api/doc/documents                          list + filter the registry
 *   POST   /api/doc/documents                          register a document
 *   PATCH  /api/doc/documents/:id                      edit title / type / audience / tags
 *   GET    /api/doc/documents/:id/versions             every version, newest first
 *   POST   /api/doc/documents/:id/upload-url           mint a signed upload URL (server picks the key)
 *   POST   /api/doc/documents/:id/versions             register the uploaded version
 *   POST   /api/doc/versions/:id/finalize              ADMIN — tick "final"
 *   POST   /api/doc/versions/:id/unfinalize            ADMIN — untick it
 *   GET    /api/doc/projects/:projectId/bindings       which documents apply to a project
 *   POST   /api/doc/projects/:projectId/bindings       bind one
 *   DELETE /api/doc/projects/:projectId/bindings/:documentId
 *
 * THE TWO-PHASE UPLOAD, AND WHY THE BYTES DO NOT COME THROUGH HERE
 * ----------------------------------------------------------------
 * A Netlify Function body is capped around 6 MB and runs on a ~10s synchronous budget; a
 * 25 MB released PDF fits neither. So the browser PUTs straight to Storage using a signed
 * upload URL for a key THIS FUNCTION chose, and then asks us to register it.
 *
 * That splits the upload from the validation, which is the interesting part: the file is
 * in the bucket before anyone has checked what it is. Registration therefore reads the
 * stored object back, checks its size and its %PDF- magic bytes, and hashes it — and
 * DELETES it and refuses if any of that fails. An unregistered object is unreachable
 * anyway (no version row points at it, and the bucket has no policies), so the window is
 * a storage leak at worst, never a serving one. The delete closes even that.
 *
 * Validating the extension or the Content-Type instead would validate a string the caller
 * chose. The bytes are the only thing that is actually true about the file.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) — for the caller-scoped project check
 */

import { createHash, randomUUID } from 'crypto';
import {
  NetlifyEvent,
  serviceClient,
  authorizeProject,
  AuthError,
  ForbiddenError,
} from './lib/http';
import {
  AUDIENCES,
  DOCUMENT_COLUMNS,
  DOC_BUCKET,
  DOC_TYPES,
  MAX_PDF_BYTES,
  VERSION_COLUMNS,
  type DocumentRow,
  type InternalCaller,
  type VersionRow,
  DocForbiddenError,
  DocNotFoundError,
  DocValidationError,
  assertDocUuid,
  assertEnum,
  assertOptionalLink,
  assertTags,
  assertText,
  docJson,
  handleDocError,
  isPdf,
  isOwnedStorageKey,
  rateLimit,
  rateLimitKey,
  requireAdmin,
  requireInternal,
  resolveCaller,
  toInternalDocumentDto,
  toInternalVersionDto,
  versionStorageKey,
} from './lib/doc-access';

/** Writes are cheap but not free, and a runaway client loop should not fill the registry. */
const WRITE_LIMIT = 60;
const READ_LIMIT = 240;
const WINDOW_SECONDS = 60;

type Supabase = ReturnType<typeof serviceClient>;

// ===========================================================================
// Routing
// ===========================================================================

/** The path segments after /api/doc/ (or after /doc-registry/ when called directly). */
const routeSegments = (path: string): string[] => {
  const stripped = path.replace(/^.*?\/(?:api\/doc|\.netlify\/functions\/doc-registry|doc-registry)\/?/, '');
  return stripped.split('/').filter(Boolean).map(decodeURIComponent);
};

const parseBody = <T>(event: NetlifyEvent): T => {
  try {
    return JSON.parse(event.body || '{}') as T;
  } catch {
    throw new DocValidationError('Invalid JSON body.');
  }
};

// ===========================================================================
// Documents
// ===========================================================================

const listDocuments = async (supabase: Supabase, event: NetlifyEvent) => {
  const q = event.queryStringParameters || {};

  let query = supabase.from('doc_documents').select(DOCUMENT_COLUMNS).order('title');

  if (q.type) query = query.eq('doc_type', assertEnum(q.type, DOC_TYPES, 'type'));
  if (q.audience) query = query.eq('audience', assertEnum(q.audience, AUDIENCES, 'audience'));
  // `contains` on a text[] compiles to the @> operator, which is what doc_documents_tags_idx
  // (GIN) is there to serve.
  if (q.tag) query = query.contains('tags', [q.tag]);
  if (q.q) {
    // ilike, not full-text search: FTS is explicitly out of scope, and a registry of a few
    // hundred titles is a substring match, not a search problem.
    const term = q.q.replace(/[%_\\]/g, m => `\\${m}`);
    query = query.ilike('title', `%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[doc-registry] document list failed:', error);
    throw new Error('Could not load the document registry.');
  }

  const documents = (data || []) as unknown as DocumentRow[];

  // One extra query for every document's final version, so the list can show "v4 · final"
  // without the client fanning out a request per row.
  const { data: finals, error: finalErr } = await supabase
    .from('doc_versions')
    .select('id, document_id, label, finalized_at')
    .eq('is_final', true);

  if (finalErr) {
    console.error('[doc-registry] final version list failed:', finalErr);
    throw new Error('Could not load the document registry.');
  }

  const finalByDocument = new Map<string, { id: string; label: string; finalizedAt: string | null }>();
  for (const f of (finals || []) as { id: string; document_id: string; label: string; finalized_at: string | null }[]) {
    finalByDocument.set(f.document_id, { id: f.id, label: f.label, finalizedAt: f.finalized_at });
  }

  return docJson(200, {
    documents: documents.map(d => ({
      ...toInternalDocumentDto(d),
      finalVersion: finalByDocument.get(d.id) ?? null,
    })),
  });
};

interface DocumentBody {
  title?: unknown;
  docType?: unknown;
  audience?: unknown;
  tags?: unknown;
  ownerUserId?: unknown;
}

const createDocument = async (supabase: Supabase, event: NetlifyEvent, caller: InternalCaller) => {
  const body = parseBody<DocumentBody>(event);

  const { data, error } = await supabase
    .from('doc_documents')
    .insert({
      title: assertText(body.title, 'title'),
      doc_type: assertEnum(body.docType, DOC_TYPES, 'docType'),
      audience: assertEnum(body.audience, AUDIENCES, 'audience'),
      tags: assertTags(body.tags),
      // The owner defaults to whoever registered it. An explicit ownerUserId is accepted
      // (an admin filing a document on a colleague's behalf) but is never taken from the
      // client without that being a deliberate field.
      owner_user_id: body.ownerUserId ? assertDocUuid(body.ownerUserId, 'ownerUserId') : caller.userId,
    })
    .select(DOCUMENT_COLUMNS)
    .single();

  if (error) {
    console.error('[doc-registry] document insert failed:', error);
    throw new Error('Could not register the document.');
  }
  return docJson(201, { document: toInternalDocumentDto(data as unknown as DocumentRow) });
};

const updateDocument = async (supabase: Supabase, event: NetlifyEvent, documentId: string) => {
  const body = parseBody<DocumentBody>(event);

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = assertText(body.title, 'title');
  if (body.docType !== undefined) patch.doc_type = assertEnum(body.docType, DOC_TYPES, 'docType');
  // Changing audience from 'supplier' to 'internal' revokes supplier access to every
  // version of the document instantly — the visibility rule reads audience live, there is
  // no cached copy anywhere to invalidate.
  if (body.audience !== undefined) patch.audience = assertEnum(body.audience, AUDIENCES, 'audience');
  if (body.tags !== undefined) patch.tags = assertTags(body.tags);
  if (body.ownerUserId !== undefined) patch.owner_user_id = assertDocUuid(body.ownerUserId, 'ownerUserId');

  if (Object.keys(patch).length === 0) throw new DocValidationError('Nothing to update.');

  const { data, error } = await supabase
    .from('doc_documents')
    .update(patch)
    .eq('id', documentId)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[doc-registry] document update failed:', error);
    throw new Error('Could not update the document.');
  }
  if (!data) throw new DocNotFoundError('No such document.');
  return docJson(200, { document: toInternalDocumentDto(data as unknown as DocumentRow) });
};

// ===========================================================================
// Versions
// ===========================================================================

const listVersions = async (supabase: Supabase, documentId: string) => {
  const { data, error } = await supabase
    .from('doc_versions')
    .select(VERSION_COLUMNS)
    .eq('document_id', documentId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[doc-registry] version list failed:', error);
    throw new Error('Could not load the versions.');
  }

  const versions = (data || []) as unknown as VersionRow[];

  const { data: events, error: eventErr } = await supabase
    .from('doc_version_events')
    .select('id, version_id, event, actor_user_id, at, note')
    .in('version_id', versions.map(v => v.id).length ? versions.map(v => v.id) : ['00000000-0000-0000-0000-000000000000'])
    .order('at', { ascending: false });

  if (eventErr) {
    console.error('[doc-registry] event list failed:', eventErr);
    throw new Error('Could not load the versions.');
  }

  return docJson(200, {
    versions: versions.map(toInternalVersionDto),
    events: (events || []).map((e: Record<string, unknown>) => ({
      id: e.id,
      versionId: e.version_id,
      event: e.event,
      actorUserId: e.actor_user_id,
      at: e.at,
      note: e.note,
    })),
  });
};

/**
 * Phase 1 of the upload. The SERVER picks both the version id and the object key, so the
 * client never gets to influence where the bytes land — the whole guarantee of
 * `versionStorageKey` (unguessable, collision-free, never derived from the title) is only
 * a guarantee because the client is not consulted.
 */
const createUploadUrl = async (supabase: Supabase, documentId: string) => {
  const { data: document, error } = await supabase
    .from('doc_documents')
    .select('id')
    .eq('id', documentId)
    .maybeSingle();
  if (error || !document) throw new DocNotFoundError('No such document.');

  const versionId = randomUUID();
  const storagePath = versionStorageKey(documentId, versionId, randomUUID());

  const { data: signed, error: signErr } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signErr || !signed?.signedUrl) {
    console.error('[doc-registry] createSignedUploadUrl failed:', signErr);
    throw new Error('Could not prepare the upload.');
  }

  return docJson(200, {
    versionId,
    storagePath,
    signedUrl: signed.signedUrl,
    token: signed.token,
    maxBytes: MAX_PDF_BYTES,
  });
};

interface RegisterVersionBody {
  versionId?: unknown;
  storagePath?: unknown;
  label?: unknown;
  sharepointLink?: unknown;
}

/**
 * Phase 2. Validates the object that was actually stored, then writes the version row.
 * The row is what makes the object reachable, so nothing is reachable until it passes.
 */
const registerVersion = async (
  supabase: Supabase,
  event: NetlifyEvent,
  documentId: string,
  caller: InternalCaller,
) => {
  const body = parseBody<RegisterVersionBody>(event);
  const label = assertText(body.label, 'label', 120);
  const sharepointLink = assertOptionalLink(body.sharepointLink, 'sharepointLink');

  const { data: document, error: docErr } = await supabase
    .from('doc_documents')
    .select('id')
    .eq('id', documentId)
    .maybeSingle();
  if (docErr || !document) throw new DocNotFoundError('No such document.');

  // A version with no PDF: allowed by the schema (and useful when the release is still
  // being produced), and unfinalisable until one is attached — the check constraint
  // doc_versions_final_requires_pdf enforces that, not this code.
  const hasUpload = body.versionId != null || body.storagePath != null;
  if (!hasUpload) {
    return insertVersion(supabase, {
      document_id: documentId,
      label,
      sharepoint_link: sharepointLink,
      uploaded_by: caller.userId,
    });
  }

  const versionId = assertDocUuid(body.versionId, 'versionId');
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';

  // The key must be one WE minted for THIS document and THIS version. Without this a
  // caller could register a version pointing at another document's object and read it
  // through their own entitlement.
  if (!isOwnedStorageKey(storagePath, documentId, versionId)) {
    throw new DocValidationError('That upload does not belong to this document.');
  }

  const pdf = await validateStoredPdf(supabase, storagePath);

  return insertVersion(supabase, {
    id: versionId,
    document_id: documentId,
    label,
    sharepoint_link: sharepointLink,
    pdf_storage_path: storagePath,
    pdf_sha256: pdf.sha256,
    pdf_bytes: pdf.bytes,
    uploaded_by: caller.userId,
  });
};

const insertVersion = async (supabase: Supabase, row: Record<string, unknown>) => {
  const { data, error } = await supabase
    .from('doc_versions')
    .insert(row)
    .select(VERSION_COLUMNS)
    .single();

  if (error) {
    console.error('[doc-registry] version insert failed:', error);
    // Clean up the object we just validated — a version row that failed to insert leaves
    // an orphan nothing will ever point at.
    if (typeof row.pdf_storage_path === 'string') {
      await supabase.storage.from(DOC_BUCKET).remove([row.pdf_storage_path]);
    }
    throw new Error('Could not register the version.');
  }
  return docJson(201, { version: toInternalVersionDto(data as unknown as VersionRow) });
};

/**
 * Read the stored object back and prove it is a PDF within the size cap. Deletes it and
 * throws if not — see the file header for why the file is already in the bucket by the
 * time we get to look at it.
 */
const validateStoredPdf = async (
  supabase: Supabase,
  storagePath: string,
): Promise<{ sha256: string; bytes: number }> => {
  const reject = async (message: string): Promise<never> => {
    await supabase.storage.from(DOC_BUCKET).remove([storagePath]);
    throw new DocValidationError(message);
  };

  // Size first, from the object's metadata, so an oversized file is refused without being
  // pulled into this function's memory. The bucket's own file_size_limit should already
  // have refused it at PUT time; this is the check that does not depend on that.
  const lastSlash = storagePath.lastIndexOf('/');
  const { data: listed, error: listErr } = await supabase.storage
    .from(DOC_BUCKET)
    .list(storagePath.slice(0, lastSlash), { search: storagePath.slice(lastSlash + 1), limit: 1 });

  if (listErr) {
    console.error('[doc-registry] storage list failed:', listErr);
    throw new Error('Could not verify the uploaded file.');
  }
  const object = (listed || [])[0];
  if (!object) throw new DocValidationError('The upload did not complete. Please try again.');

  const size = Number((object as { metadata?: { size?: number } }).metadata?.size ?? 0);
  if (size <= 0) return reject('The uploaded file is empty.');
  if (size > MAX_PDF_BYTES) {
    return reject(`The released PDF must be ${Math.floor(MAX_PDF_BYTES / 1048576)} MB or smaller.`);
  }

  const { data: blob, error: dlErr } = await supabase.storage.from(DOC_BUCKET).download(storagePath);
  if (dlErr || !blob) {
    console.error('[doc-registry] storage download failed:', dlErr);
    throw new Error('Could not verify the uploaded file.');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return reject(`The released PDF must be ${Math.floor(MAX_PDF_BYTES / 1048576)} MB or smaller.`);
  }
  if (!isPdf(bytes)) {
    return reject('The released file must be a PDF.');
  }

  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
};

// ===========================================================================
// Finalise / un-finalise — admin only
// ===========================================================================

const setFinal = async (
  supabase: Supabase,
  event: NetlifyEvent,
  versionId: string,
  caller: InternalCaller,
  final: boolean,
) => {
  const body = parseBody<{ note?: unknown }>(event);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  // The whole state change is one round trip because it is one transaction in the
  // database — see doc_finalize_version in migration 159. Doing it as three statements
  // from here would leave a window with two finals, or a final with no event row.
  const { data, error } = await supabase.rpc(
    final ? 'doc_finalize_version' : 'doc_unfinalize_version',
    { p_version_id: versionId, p_actor: caller.userId, p_note: note },
  );

  if (error) {
    // The function raises no_data_found for an unknown id and check_violation when a
    // version has no PDF yet; both are the caller's problem, not a server fault.
    if (error.code === 'P0002' || /No such version/i.test(error.message || '')) {
      throw new DocNotFoundError('No such document version.');
    }
    if (/cannot be finalised/i.test(error.message || '')) {
      throw new DocValidationError('Upload the released PDF before marking this version final.');
    }
    console.error('[doc-registry] finalize rpc failed:', error);
    throw new Error(final ? 'Could not finalise the version.' : 'Could not un-finalise the version.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as unknown as VersionRow;
  return docJson(200, { version: toInternalVersionDto(row) });
};

// ===========================================================================
// Bindings
// ===========================================================================
//
// Authorization here is deliberately NOT "is this caller internal". Binding a document to
// a project is a change to that project, so it is gated on the caller being able to see
// the project — `authorizeProject` re-asks Postgres as the caller, so PM-scoped RLS
// (migration 81) answers it and this file does not re-implement the rule.

const listBindings = async (supabase: Supabase, projectId: string) => {
  const { data, error } = await supabase
    .from('doc_bindings')
    .select('id, document_id, created_by, created_at')
    .eq('project_id', projectId);

  if (error) {
    console.error('[doc-registry] binding list failed:', error);
    throw new Error('Could not load the bound documents.');
  }

  const bindings = (data || []) as { id: string; document_id: string; created_by: string | null; created_at: string }[];
  if (bindings.length === 0) return docJson(200, { bindings: [] });

  const { data: documents, error: docErr } = await supabase
    .from('doc_documents')
    .select(DOCUMENT_COLUMNS)
    .in('id', bindings.map(b => b.document_id));

  if (docErr) {
    console.error('[doc-registry] bound document list failed:', docErr);
    throw new Error('Could not load the bound documents.');
  }

  const byId = new Map((documents || []).map((d: unknown) => [(d as DocumentRow).id, d as DocumentRow]));

  return docJson(200, {
    bindings: bindings
      .map(b => {
        const doc = byId.get(b.document_id);
        return doc
          ? { id: b.id, createdBy: b.created_by, createdAt: b.created_at, document: toInternalDocumentDto(doc) }
          : null;
      })
      .filter(Boolean),
  });
};

const createBinding = async (
  supabase: Supabase,
  event: NetlifyEvent,
  projectId: string,
  caller: InternalCaller,
) => {
  const body = parseBody<{ documentId?: unknown }>(event);
  const documentId = assertDocUuid(body.documentId, 'documentId');

  const { error } = await supabase
    .from('doc_bindings')
    // upsert, not insert: binding a document that is already bound is what a person
    // clicking twice means, and it is not an error worth showing them.
    .upsert({ project_id: projectId, document_id: documentId, created_by: caller.userId },
            { onConflict: 'project_id,document_id' });

  if (error) {
    if (error.code === '23503') throw new DocNotFoundError('No such document.');
    console.error('[doc-registry] binding insert failed:', error);
    throw new Error('Could not bind the document to this project.');
  }
  return docJson(201, { ok: true });
};

const deleteBinding = async (supabase: Supabase, projectId: string, documentId: string) => {
  const { error } = await supabase
    .from('doc_bindings')
    .delete()
    .eq('project_id', projectId)
    .eq('document_id', documentId);

  if (error) {
    console.error('[doc-registry] binding delete failed:', error);
    throw new Error('Could not unbind the document.');
  }
  return docJson(200, { ok: true });
};

// ===========================================================================
// Handler
// ===========================================================================

export const handler = async (event: NetlifyEvent) => {
  let supabase: Supabase;
  try {
    supabase = serviceClient();
  } catch (e) {
    return docJson(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  try {
    const caller = requireInternal(await resolveCaller(event, supabase));
    const method = event.httpMethod;
    const isRead = method === 'GET';

    await rateLimit(
      supabase,
      rateLimitKey(isRead ? 'doc-registry-read' : 'doc-registry-write', caller),
      isRead ? READ_LIMIT : WRITE_LIMIT,
      WINDOW_SECONDS,
    );

    const segments = routeSegments(event.path ?? '');
    const [resource, id, sub, subId] = segments;

    if (resource === 'documents') {
      if (!id) {
        if (method === 'GET') return await listDocuments(supabase, event);
        if (method === 'POST') return await createDocument(supabase, event, caller);
        return docJson(405, { error: 'Method not allowed' });
      }

      assertDocUuid(id, 'documentId');

      if (!sub) {
        if (method === 'PATCH') return await updateDocument(supabase, event, id);
        return docJson(405, { error: 'Method not allowed' });
      }
      if (sub === 'versions') {
        if (method === 'GET') return await listVersions(supabase, id);
        if (method === 'POST') return await registerVersion(supabase, event, id, caller);
        return docJson(405, { error: 'Method not allowed' });
      }
      if (sub === 'upload-url' && method === 'POST') return await createUploadUrl(supabase, id);

      throw new DocNotFoundError('Unknown route.');
    }

    if (resource === 'versions') {
      assertDocUuid(id, 'versionId');
      if (method !== 'POST') return docJson(405, { error: 'Method not allowed' });
      // The single admin gate for the module's one privileged action.
      if (sub === 'finalize') return await setFinal(supabase, event, id, requireAdmin(caller), true);
      if (sub === 'unfinalize') return await setFinal(supabase, event, id, requireAdmin(caller), false);
      throw new DocNotFoundError('Unknown route.');
    }

    if (resource === 'projects') {
      const projectId = assertDocUuid(id, 'projectId');
      if (sub !== 'bindings') throw new DocNotFoundError('Unknown route.');

      // Re-asked as the caller, so PM scoping decides. Mapped to this module's error
      // types so the response shape stays consistent with everything else here.
      try {
        await authorizeProject(event, projectId);
      } catch (e) {
        if (e instanceof ForbiddenError) throw new DocForbiddenError('You do not have access to this project.');
        if (e instanceof AuthError) throw e;
        throw e;
      }

      if (method === 'GET' && !subId) return await listBindings(supabase, projectId);
      if (method === 'POST' && !subId) return await createBinding(supabase, event, projectId, caller);
      if (method === 'DELETE' && subId) return await deleteBinding(supabase, projectId, assertDocUuid(subId, 'documentId'));
      return docJson(405, { error: 'Method not allowed' });
    }

    throw new DocNotFoundError('Unknown route.');
  } catch (e) {
    if (e instanceof AuthError) return docJson(401, { error: e.message });
    return handleDocError(e);
  }
};
