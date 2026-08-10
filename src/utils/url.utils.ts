/**
 * URL safety helpers.
 *
 * Any URL that originates from a supplier/external user (RFQ links, attachment
 * URLs, quote-file URLs) MUST pass through here before being rendered into an
 * `<a href>` or used as an image `src`. React does NOT block `javascript:`,
 * `data:`, or `vbscript:` URLs in `href` — it only logs a dev warning — so a
 * stored `javascript:…` link executes in the viewer's origin (with their live
 * session) the moment they click it. That is a stored-XSS vector; this module is
 * the single choke point that closes it.
 */

const SAFE_HREF_SCHEMES = ['http:', 'https:', 'mailto:'];

/**
 * True when `url` is safe to place in an href/src: an http(s)/mailto absolute URL,
 * or a site-relative path (which can never be a `javascript:` URL).
 */
export const isSafeUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Site-relative path ("/foo", but not protocol-relative "//host") — always safe.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return SAFE_HREF_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
};

/**
 * Returns `url` when it is safe to use as an href/src, otherwise `undefined`.
 * Passing `undefined` to an anchor's `href` renders a non-navigable link rather
 * than an exploitable one — the safe failure mode for untrusted URLs.
 */
export const safeHref = (url: string | null | undefined): string | undefined =>
  isSafeUrl(url) ? url!.trim() : undefined;

/** True only for an ABSOLUTE http(s) URL — used to validate user-entered links. */
export const isExternalHttpUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Normalize a user-entered link to an absolute http(s) URL, or return null if it
 * cannot be made into one safely. A bare "example.com/x" is upgraded to https;
 * anything that resolves to a non-http(s) scheme (e.g. `javascript:`) is rejected.
 */
export const normalizeExternalLink = (raw: string): string | null => {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return isExternalHttpUrl(candidate) ? candidate : null;
};
