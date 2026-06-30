/**
 * Signed-URL helpers for the private `documents` storage bucket.
 *
 * - Portal (anon, no Supabase session): request a short-lived signed URL from the
 *   service-role Netlify function, which validates portal token / access code.
 * - PM (authenticated): create a signed URL directly with the session via the
 *   authenticated storage policy.
 *
 * Both fall back to the originally stored URL if signing fails, so the app keeps
 * working while the bucket is still public (during the migration window).
 */

import { supabase } from '../core/supabase.client';

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
  /** stored URL to fall back to if signing fails (e.g. bucket still public) */
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
    } else {
      console.warn('getPortalDocumentUrl: function returned', res.status);
    }
  } catch (e) {
    console.warn('getPortalDocumentUrl failed', e);
  }
  return opts.fallbackUrl;
};

/**
 * PM (authenticated) signed URL for a stored document URL. Falls back to the
 * original URL if signing fails.
 */
export const getSignedDocumentUrl = async (fileUrl: string): Promise<string> => {
  const path = toStoragePath(fileUrl);
  if (!path) return fileUrl;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS);
    if (!error && data?.signedUrl) return data.signedUrl;
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
