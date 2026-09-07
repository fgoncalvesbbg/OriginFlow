/**
 * Signed-URL helpers for the private `documents` storage bucket.
 *
 * - Portal (anon, no Supabase session): request a short-lived signed URL from the
 *   service-role Netlify function, which validates portal token / access code.
 * - PM (authenticated): create a signed URL directly with the session via the
 *   authenticated storage policy.
 *
 * Failure handling is deliberately asymmetric. An explicit REFUSAL from the issuer
 * (401/403/404 - wrong token, or a document not visible to suppliers) must NEVER fall back
 * to the stored URL: for an `im-print` file that URL is still publicly readable until the
 * bucket flip, so falling back would quietly undo the server-side
 * `is_visible_to_supplier` check the issuer performs. Only a transport/5xx failure falls
 * back, and that fallback is the last remnant of the public-bucket migration window - it
 * should be deleted once `im-print` is private.
 */

import { storage } from '../../data';

const ENDPOINT = '/.netlify/functions/supplier-file-url';
const BUCKET = 'documents';
const SIGNED_TTL_SECONDS = 120;

/** Strip the host/bucket prefix from a stored public URL to get the in-bucket path. */
const toStoragePath = (fileUrl: string): string | null => {
  if (!fileUrl) return null;
  const m = fileUrl.match(/\/documents\/(.+)$/);
  if (m) return decodeURIComponent(m[1]);
  return fileUrl.startsWith('http') ? null : fileUrl.replace(/^\/+/, '');
};

interface PortalUrlOpts {
  /** project portal token (projects.supplier_link_token) */
  projectToken?: string;
  /** supplier portal token (suppliers.portal_token) */
  supplierToken?: string;
  /** supplier access code, required with supplierToken */
  accessCode?: string;
  /** stored URL, used ONLY when the issuer could not be reached (never on a refusal) */
  fallbackUrl?: string;
}

/**
 * Portal (anon) signed URL for a document, authorized server-side by the
 * Netlify function. Returns a usable URL or undefined.
 */
export const getPortalDocumentUrl = async (docId: string, opts: PortalUrlOpts): Promise<string | undefined> => {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docId,
        projectToken: opts.projectToken,
        supplierToken: opts.supplierToken,
        accessCode: opts.accessCode,
      }),
    });
    if (res.ok) {
      const { url } = await res.json();
      if (url) return url;
      console.warn('getPortalDocumentUrl: issuer returned no url');
      return undefined;
    }
    // The issuer answered and REFUSED. Surface that as "no document" rather than handing
    // back a URL it just declined to sign - see the asymmetry note in the file header.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      console.warn('getPortalDocumentUrl: access refused', res.status);
      return undefined;
    }
    console.warn('getPortalDocumentUrl: issuer error', res.status);
  } catch (e) {
    // Transport failure - the issuer never rendered a verdict.
    console.warn('getPortalDocumentUrl failed', e);
  }
  return opts.fallbackUrl;
};

/**
 * PM (authenticated) signed URL for a stored document URL. Falls back to the
 * original URL if signing fails.
 */
const getSignedDocumentUrl = async (fileUrl: string): Promise<string> => {
  const path = toStoragePath(fileUrl);
  if (!path) return fileUrl;
  try {
    return await storage.createSignedUrl(BUCKET, path, SIGNED_TTL_SECONDS);
  } catch (e) {
    console.warn('getSignedDocumentUrl failed', e);
  }
  return fileUrl;
};

/** Open a document in a new tab via a freshly signed PM URL. */
export const openSignedDocument = async (fileUrl: string): Promise<void> => {
  const url = await getSignedDocumentUrl(fileUrl);
  window.open(url, '_blank', 'noopener,noreferrer');
};
