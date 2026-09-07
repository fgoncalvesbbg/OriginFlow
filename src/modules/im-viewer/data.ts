/**
 * Data loading for the IM viewer — plain `fetch`, no app services or Supabase client.
 * This is what lets the module render whatever manifest/manual URL it is handed, on any platform.
 */

import { Manifest, ResolvedManual } from './types';

/**
 * Rewrites a URL right before it is fetched — e.g. turning a public-bucket URL embedded in a
 * manifest into a freshly minted, short-TTL signed one. Optional and host-supplied: this
 * module stays dependency-free and knows nothing about signing, tokens or Supabase; a host
 * that needs re-validated access (see `IMViewerProps.resolveUrl`) hands in a closure that does.
 */
export type UrlResolver = (url: string) => Promise<string>;

const fetchOnce = (url: string, resolveUrl?: UrlResolver): Promise<Response> =>
  Promise.resolve(resolveUrl ? resolveUrl(url) : url).then((target) =>
    fetch(target, { headers: { Accept: 'application/json' } }),
  );

const fetchJson = async <T>(url: string, what: string, resolveUrl?: UrlResolver): Promise<T> => {
  let res: Response;
  try {
    res = await fetchOnce(url, resolveUrl);
    // A signed URL can expire while this manual stays open (language switch after a long
    // read, or a page left open past the TTL). One retry with a FRESH mint — not a cached
    // one — turns that into an invisible recovery instead of a broken viewer; the host's
    // `resolveUrl` is expected to hit its signing endpoint again each call, never memoize.
    if (!res.ok && (res.status === 401 || res.status === 403) && resolveUrl) {
      res = await fetchOnce(url, resolveUrl);
    }
  } catch (e: any) {
    throw new Error(`Could not reach ${what} (${url}): ${e?.message ?? 'network error'}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to load ${what} (${url}): HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${what} is not valid JSON (${url})`);
  }
};

export const loadManifest = (url: string, resolveUrl?: UrlResolver): Promise<Manifest> =>
  fetchJson<Manifest>(url, 'manifest', resolveUrl);

export const loadManual = (url: string, resolveUrl?: UrlResolver): Promise<ResolvedManual> =>
  fetchJson<ResolvedManual>(url, 'manual', resolveUrl);
