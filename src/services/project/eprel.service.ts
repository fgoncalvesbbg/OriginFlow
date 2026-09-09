/**
 * EPREL registry lookup — the Attribute Viewer's independent cross-check axis.
 *
 * Read-only and never persisted: every call goes to the Netlify function, which goes to the EU
 * registry. That is the point — the registry is a second opinion, and a cached second opinion is
 * only ever "what it said at some earlier time". Do not add an `eprel_*` snapshot column.
 *
 * FAILURE IS ALWAYS SOFT, and this matters more here than anywhere else in the module. The
 * registry is a public service we do not own: it can be slow, rate-limited, or down, and the
 * grid must render regardless. So this never rejects, the caller fires it AFTER the grid has
 * painted, and every outcome is reported through the returned fields:
 *
 *   configured: false  → no API key on the server; hide the registry column entirely
 *   error              → it is set up but the lookup failed; show the axis as "not checked"
 *   results[reg]       → per-registration, and a miss is an ANSWER not an error
 *
 * "not-found" specifically means the model is not in the PUBLIC api — which includes every
 * model whose registration is not yet verified by the Commission. That is a real, common,
 * reportable state, and collapsing it into "unreachable" would tell somebody to check their
 * network when the truth is that the registration is pending.
 */
import { auth } from '../../data';

const ENDPOINT = '/.netlify/functions/eprel-lookup';

/** Must not exceed MAX_REGISTRATIONS in netlify/functions/eprel-lookup.ts. */
const CHUNK_SIZE = 40;

const ENDPOINT_MISSING_MESSAGE =
  'The EPREL endpoint is not being served. Run the app with `netlify dev` — plain `vite` does not serve functions.';

export type EprelMissReason = 'not-found' | 'invalid' | 'unreachable' | 'rejected';

export type EprelLookupResult =
  | { found: true; record: Record<string, unknown> }
  | { found: false; reason: EprelMissReason; detail?: string };

export interface EprelLookupResponse {
  /** False when the server has no EPREL API key — callers should hide the axis entirely. */
  configured: boolean;
  /** Keyed by the exact registration string that was passed in. */
  results: Record<string, EprelLookupResult>;
  /** Human-readable problem, if any. Present alongside partial results. */
  error?: string;
}

/** Once we know functions are not served, stop retrying on every render. */
let endpointMissing = false;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Look up a batch of EPREL registration numbers.
 *
 * @returns Never rejects. `configured: false` means "EPREL is not set up".
 */
export const lookupEprelRecords = async (
  registrations: readonly string[],
): Promise<EprelLookupResponse> => {
  const wanted = Array.from(
    new Set(registrations.filter(r => typeof r === 'string' && r.trim() !== '').map(r => r.trim())),
  );
  if (wanted.length === 0) return { configured: true, results: {} };
  if (endpointMissing) return { configured: false, results: {}, error: ENDPOINT_MISSING_MESSAGE };

  // Guarded because callers fire this without awaiting, so a throw would surface as an
  // unhandled rejection and leave the axis stuck on "loading".
  let token: string | undefined;
  try {
    token = (await auth.getSession())?.accessToken;
  } catch (e: any) {
    return { configured: false, results: {}, error: e?.message || 'Could not read the current session.' };
  }
  if (!token) {
    return { configured: false, results: {}, error: 'You must be signed in to read the EPREL registry.' };
  }

  const results: Record<string, EprelLookupResult> = {};
  let configured = true;
  let error: string | undefined;

  const responses = await Promise.all(
    chunk(wanted, CHUNK_SIZE).map(async (batch): Promise<Partial<EprelLookupResponse>> => {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ registrations: batch }),
        });
        if (res.status === 404) {
          endpointMissing = true;
          return { configured: false, error: ENDPOINT_MISSING_MESSAGE };
        }
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { error: (payload as any)?.error || `EPREL lookup failed (${res.status}).` };
        }
        if ((payload as any)?.configured === false) {
          return { configured: false, error: (payload as any)?.reason };
        }
        return { results: (payload as any)?.results || {} };
      } catch (e: any) {
        return { error: e?.message || 'EPREL lookup failed.' };
      }
    }),
  );

  for (const r of responses) {
    if (r.configured === false) configured = false;
    if (r.error && !error) error = r.error;
    Object.assign(results, r.results || {});
  }

  return { configured, results, error };
};
