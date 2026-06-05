/**
 * Data loading for the IM viewer — plain `fetch`, no app services or Supabase client.
 * This is what lets the module render whatever manifest/manual URL it is handed, on any platform.
 */

import { Manifest, ResolvedManual } from './types';

const fetchJson = async <T>(url: string, what: string): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
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

export const loadManifest = (url: string): Promise<Manifest> =>
  fetchJson<Manifest>(url, 'manifest');

export const loadManual = (url: string): Promise<ResolvedManual> =>
  fetchJson<ResolvedManual>(url, 'manual');
