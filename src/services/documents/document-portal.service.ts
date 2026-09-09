/**
 * SOP & Documents — the project-scoped client, for the Documents tab.
 *
 * Serves both sides of the wall from one module because it calls one route
 * (/api/doc-portal/*), which decides what to return from the CALLER'S credential rather
 * than from a parameter. A supplier on the portal passes their portal token; a signed-in
 * PM passes their session. Neither can ask for the other's view.
 *
 * `downloadDocument` is the only way the app fetches document bytes, on either side.
 */

import { auth } from '../../data';
import type { InternalProjectDocument, SupplierProjectDocument } from '../../types/document.types';

const API = '/api/doc-portal';

/** How a supplier proves who they are: whichever portal credential the page was opened with. */
export interface PortalCredentials {
  /** projects.supplier_link_token — the /#/supplier/:token link. */
  projectToken?: string;
  /** suppliers.portal_token + access code — the supplier dashboard link. */
  supplierToken?: string;
  accessCode?: string;
}

/**
 * Portal credentials travel in headers, never in the query string: a query string reaches
 * server logs, the `Referer` of every outbound link on the page, and any bookmark. The
 * access code in particular is a real secret that otherwise only ever moves in a POST body.
 */
const portalHeaders = (credentials: PortalCredentials): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (credentials.projectToken) headers['x-portal-token'] = credentials.projectToken;
  if (credentials.supplierToken && credentials.accessCode) {
    headers['x-supplier-token'] = credentials.supplierToken;
    headers['x-supplier-code'] = credentials.accessCode;
  }
  return headers;
};

const callerHeaders = async (credentials?: PortalCredentials): Promise<Record<string, string>> => {
  if (credentials && (credentials.projectToken || credentials.supplierToken)) {
    return portalHeaders(credentials);
  }
  const session = await auth.getSession();
  if (!session?.accessToken) throw new Error('You must be signed in to view these documents.');
  return { Authorization: `Bearer ${session.accessToken}` };
};

const request = async <T>(path: string, credentials: PortalCredentials | undefined, init: RequestInit = {}): Promise<T> => {
  const headers = await callerHeaders(credentials);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error || `Request failed (${res.status}).`);
  }
  return payload as T;
};

/**
 * The documents that apply to a project.
 *
 * A supplier gets only released, supplier-facing, bound documents — the server applies all
 * three clauses, and an empty array is a perfectly ordinary answer (nothing bound yet, or
 * the project belongs to someone else; the two are deliberately indistinguishable).
 */
export const getSupplierProjectDocuments = async (
  credentials: PortalCredentials,
  projectId?: string,
): Promise<SupplierProjectDocument[]> => {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const { documents } = await request<{ documents: SupplierProjectDocument[] }>(
    `/project-documents${query}`,
    credentials,
  );
  return documents;
};

/** The same list for a signed-in internal user, who additionally sees internal documents. */
export const getInternalProjectDocuments = async (
  projectId: string,
): Promise<InternalProjectDocument[]> => {
  const { documents } = await request<{ documents: InternalProjectDocument[] }>(
    `/project-documents?projectId=${encodeURIComponent(projectId)}`,
    undefined,
  );
  return documents;
};

/**
 * Download a released PDF.
 *
 * Two steps, and the reason is worth knowing before anyone "simplifies" it. The download
 * route is a 302 to a 120-second signed URL, and the filename the user actually gets comes
 * from the header Storage puts on the response carrying the bytes — which means the
 * browser has to NAVIGATE to the route, not fetch it. A navigation cannot carry an
 * Authorization or x-portal-token header, and fetching instead does not work either: a
 * CORS-mode fetch cannot follow a cross-origin redirect while carrying a custom header.
 *
 * So we mint a single-use, 60-second ticket with the credential we do have, and navigate
 * with that. The ticket authenticates; the route re-checks entitlement before it signs
 * anything, so a version un-finalised in between is refused with the ticket in hand.
 */
export const downloadDocument = async (
  versionId: string,
  credentials?: PortalCredentials,
): Promise<void> => {
  const { url } = await request<{ url: string }>('/download-ticket', credentials, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });

  // A same-origin navigation. `noopener` because the target eventually redirects
  // off-origin and the opened context has no business reaching back into this one.
  window.open(url, '_blank', 'noopener,noreferrer');
};
