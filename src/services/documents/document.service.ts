/**
 * SOP & Documents — the internal registry client.
 *
 * WHY THIS FILE TALKS HTTP AND NOT `db`
 * --------------------------------------
 * Every other service in this app reaches Supabase through the ports in `src/data`, and
 * RLS decides what comes back. This one deliberately does not, and must not:
 *
 *   - doc_* is RLS default-deny with the PostgREST grants revoked (migration 159), so a
 *     port call would fail regardless;
 *   - and it *should* fail. `doc_versions.sharepoint_link` is internal-only while some
 *     rows of the same table are supplier-visible. RLS filters rows, not columns, so the
 *     decision "may this caller be told this FIELD" cannot be made in the database. It is
 *     made by the DTO whitelists in netlify/functions/lib/doc-access.ts, and the only way
 *     to guarantee those run is for the browser to have no other route in.
 *
 * So: fetch, to our own /api/doc/* routes, with the session's bearer token. If you find
 * yourself adding `db.select('doc_...')` anywhere in src/, that is the bug.
 */

import { auth } from '../../data';
import type {
  DocumentAudience,
  DocumentBinding,
  DocumentRegistryFilters,
  DocumentType,
  DocumentVersion,
  DocumentVersionEvent,
  RegisteredDocument,
  RegisteredDocumentRow,
} from '../../types/document.types';

const API = '/api/doc';

/** Present when the app is served without the functions (a bare `vite` dev server). */
const ENDPOINT_MISSING =
  'The document service is not available. Run the app through `netlify dev` so the /api routes are served.';

const authHeaders = async (): Promise<Record<string, string>> => {
  const session = await auth.getSession();
  if (!session?.accessToken) throw new Error('You must be signed in to use the document registry.');
  return { Authorization: `Bearer ${session.accessToken}` };
};

/**
 * One place where an HTTP response becomes either data or a throw with a message worth
 * showing. The server's own `error` string is preferred — those are written for people
 * ("Upload the released PDF before marking this version final") rather than for logs.
 */
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = await authHeaders();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 404 && !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(ENDPOINT_MISSING);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error || `Request failed (${res.status}).`);
  }
  return payload as T;
};

const queryString = (filters: DocumentRegistryFilters): string => {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.audience) params.set('audience', filters.audience);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  const s = params.toString();
  return s ? `?${s}` : '';
};

// ===========================================================================
// Documents
// ===========================================================================

/** The registry list. Filters are applied server-side, against the indexes in 159. */
export const getDocuments = async (
  filters: DocumentRegistryFilters = {},
): Promise<RegisteredDocumentRow[]> => {
  const { documents } = await request<{ documents: RegisteredDocumentRow[] }>(
    `/documents${queryString(filters)}`,
  );
  return documents;
};

export const createDocument = async (input: {
  title: string;
  docType: DocumentType;
  audience: DocumentAudience;
  tags?: string[];
}): Promise<RegisteredDocument> => {
  const { document } = await request<{ document: RegisteredDocument }>('/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return document;
};

export const updateDocument = async (
  documentId: string,
  patch: Partial<Pick<RegisteredDocument, 'title' | 'docType' | 'audience' | 'tags'>>,
): Promise<RegisteredDocument> => {
  const { document } = await request<{ document: RegisteredDocument }>(`/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return document;
};

// ===========================================================================
// Versions
// ===========================================================================

export const getVersions = async (
  documentId: string,
): Promise<{ versions: DocumentVersion[]; events: DocumentVersionEvent[] }> =>
  request<{ versions: DocumentVersion[]; events: DocumentVersionEvent[] }>(
    `/documents/${documentId}/versions`,
  );

/**
 * Register a new version: upload the PDF, then record it.
 *
 * Two round trips because the bytes must not pass through a Netlify Function (6 MB body
 * cap, ~10s budget). The server picks the storage key in step 1 and validates the stored
 * object's magic bytes in step 2 — see the doc-registry.ts header. The browser's only job
 * is the PUT in between.
 *
 * `onProgress` is deliberately coarse (three states, not a byte count): the upload goes
 * straight to Storage with `fetch`, which has no upload-progress event, and faking one
 * would be worse than saying which of the three steps is running.
 */
export const createVersion = async (params: {
  documentId: string;
  label: string;
  sharepointLink?: string | null;
  file: File;
  onProgress?: (stage: 'preparing' | 'uploading' | 'registering') => void;
}): Promise<DocumentVersion> => {
  const { documentId, label, sharepointLink, file, onProgress } = params;

  // Checked here purely so an obvious mistake fails instantly instead of after a 25 MB
  // upload. The check that MATTERS is the server reading the stored bytes.
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('The released file must be a PDF.');
  }

  onProgress?.('preparing');
  const prepared = await request<{
    versionId: string;
    storagePath: string;
    signedUrl: string;
    maxBytes: number;
  }>(`/documents/${documentId}/upload-url`, { method: 'POST', body: '{}' });

  if (file.size > prepared.maxBytes) {
    throw new Error(`The released PDF must be ${Math.floor(prepared.maxBytes / 1048576)} MB or smaller.`);
  }

  onProgress?.('uploading');
  const upload = await fetch(prepared.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: file,
  });
  if (!upload.ok) throw new Error('The upload failed. Please try again.');

  onProgress?.('registering');
  const { version } = await request<{ version: DocumentVersion }>(
    `/documents/${documentId}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({
        versionId: prepared.versionId,
        storagePath: prepared.storagePath,
        label,
        sharepointLink: sharepointLink || null,
      }),
    },
  );
  return version;
};

/** Admin only. Atomic in the database: see doc_finalize_version in migration 159. */
export const finalizeVersion = async (versionId: string, note?: string): Promise<DocumentVersion> => {
  const { version } = await request<{ version: DocumentVersion }>(`/versions/${versionId}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ note: note || null }),
  });
  return version;
};

/** Admin only. Takes the version out of supplier visibility immediately. */
export const unfinalizeVersion = async (versionId: string, note?: string): Promise<DocumentVersion> => {
  const { version } = await request<{ version: DocumentVersion }>(`/versions/${versionId}/unfinalize`, {
    method: 'POST',
    body: JSON.stringify({ note: note || null }),
  });
  return version;
};

// ===========================================================================
// Bindings
// ===========================================================================

export const getProjectBindings = async (projectId: string): Promise<DocumentBinding[]> => {
  const { bindings } = await request<{ bindings: DocumentBinding[] }>(`/projects/${projectId}/bindings`);
  return bindings;
};

export const bindDocumentToProject = async (projectId: string, documentId: string): Promise<void> => {
  await request(`/projects/${projectId}/bindings`, {
    method: 'POST',
    body: JSON.stringify({ documentId }),
  });
};

export const unbindDocumentFromProject = async (projectId: string, documentId: string): Promise<void> => {
  await request(`/projects/${projectId}/bindings/${documentId}`, { method: 'DELETE' });
};

// ===========================================================================
// The stable template link
// ===========================================================================

/**
 * The "get the latest template" URL for a document: one click, always the current final
 * PDF, safe to paste into a wiki or an email because it names the DOCUMENT rather than a
 * version. It resolves at click time, so it follows every future release without anyone
 * updating the link — and 404s rather than serving something that has been withdrawn.
 */
export const latestVersionUrl = (documentId: string): string =>
  `${window.location.origin}/api/documents/${documentId}/latest`;
