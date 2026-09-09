/**
 * EPREL registry lookup (Netlify Function) — the independent cross-check axis.
 *
 * Given EPREL registration numbers, returns each model's public record from the EU product
 * registry so the Attribute Viewer can compare our stored values against the registry's own
 * figures. Nothing is written; every call hits EPREL, so a refresh always shows the truth.
 *
 *   POST /api/eprel-lookup
 *   Authorization: Bearer <supabase session token>
 *   { "registrations": ["123456", "234567"] }
 *
 *   200 { configured: true, results: { "123456": { found: true, record: {...} },
 *                                      "234567": { found: false, reason: "not-found" } } }
 *   200 { configured: false, reason: "..." }   ← env not set up; the UI hides the feature
 *
 * WHY A SERVER FUNCTION: the EPREL API key must never reach the browser, and the registry
 * sends no CORS headers that would let the SPA call it directly. Same shape as jira-status.ts.
 *
 * WHY AUTHENTICATED even though EPREL's data is public: the call spends OUR api key and its
 * quota. An open endpoint would let anyone burn it.
 *
 * ── WHAT IS VERIFIED, AND WHAT IS NOT ─────────────────────────────────────────────────────
 *
 * Verified (2026-09-09, from the Commission's own pages):
 *   * the public API lives at https://eprel.ec.europa.eu/api and answers JSON;
 *   * it is keyed on the EPREL registration number — the number in the label's QR code;
 *   * an API KEY IS REQUIRED, requested at https://eprel.ec.europa.eu/screen/requestpublicapikey;
 *   * **only VERIFIED models are retrievable** — an unverified registration answers as absent,
 *     which is why "not found" is reported plainly rather than treated as an error.
 *
 * NOT verified, because the endpoint syntax lives in the EPREL wiki behind EU Login:
 *   * the exact product path, and
 *   * the exact API-key header name.
 *
 * So both are ENV-DRIVEN TEMPLATES rather than hard-coded guesses (EPREL_PRODUCT_PATH,
 * EPREL_API_KEY_HEADER). Correcting them is a deploy variable, not a code change and a release.
 * The defaults are the most likely shapes, and `probe: true` echoes the exact URL and headers
 * the function would use so they can be checked against the wiki without reading this file.
 *
 * The FIELD names inside the record are not guessed at all: they come from the data. Twelve
 * attributes already carry `category_attributes.eprel_id` values written by the team —
 * `energyClass`, `energyAnnual`, `airFlowMax`, `greaseFilteringEfficiencyClass`,
 * `soundPowerBoost` — so the response is read by those keys and the comparison never needs to
 * know the schema. See components/products/attribute-grid/eprel-compare.utils.ts.
 */
import { NetlifyEvent, json, authenticate, AuthError, ConfigError } from './lib/http';

/** Bounded so one screen's worth of SKUs is a single call and nothing more. */
const MAX_REGISTRATIONS = 40;

/** How many registry calls run at once. Polite to a public service we do not own. */
const CONCURRENCY = 4;

/** Per-call ceiling. A slow registry must never hold the whole batch open. */
const TIMEOUT_MS = 8000;

const DEFAULT_BASE = 'https://eprel.ec.europa.eu/api';
const DEFAULT_PRODUCT_PATH = '/product/{registration}';
const DEFAULT_KEY_HEADER = 'x-api-key';

/** A registration number: digits, as EPREL issues them. Anything else is not looked up. */
const VALID_REGISTRATION = /^\d{1,15}$/;

type LookupResult =
  | { found: true; record: Record<string, unknown> }
  | { found: false; reason: 'not-found' | 'invalid' | 'unreachable' | 'rejected'; detail?: string };

const lookupOne = async (
  registration: string,
  config: { base: string; path: string; keyHeader: string; apiKey: string },
): Promise<LookupResult> => {
  if (!VALID_REGISTRATION.test(registration)) {
    return { found: false, reason: 'invalid', detail: 'Not an EPREL registration number.' };
  }

  const url = config.base + config.path.replace('{registration}', encodeURIComponent(registration));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { [config.keyHeader]: config.apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });

    // An unverified or withdrawn model is genuinely absent from the public API. That is an
    // answer, not a failure — and it is a different answer from "we could not ask", which is
    // why the two never collapse into one.
    if (res.status === 404) return { found: false, reason: 'not-found' };

    if (!res.ok) {
      return {
        found: false,
        reason: 'rejected',
        detail: `EPREL answered ${res.status}. If this is 401/403 the API key or its header name is wrong.`,
      };
    }

    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { found: false, reason: 'rejected', detail: 'EPREL did not answer a JSON object.' };
    }
    return { found: true, record: body as Record<string, unknown> };
  } catch (e: any) {
    return {
      found: false,
      reason: 'unreachable',
      detail: e?.name === 'AbortError' ? `No answer within ${TIMEOUT_MS}ms.` : 'Network failure.',
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Run the lookups a few at a time, so one batch cannot become forty simultaneous requests. */
const inBatches = async (
  registrations: string[],
  config: Parameters<typeof lookupOne>[1],
): Promise<Record<string, LookupResult>> => {
  const out: Record<string, LookupResult> = {};
  for (let i = 0; i < registrations.length; i += CONCURRENCY) {
    const slice = registrations.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(slice.map(r => lookupOne(r, config)));
    slice.forEach((r, idx) => {
      out[r] = settled[idx];
    });
  }
  return out;
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Auth first: this spends our API key's quota.
  try {
    await authenticate(event);
  } catch (e) {
    if (e instanceof ConfigError) return json(500, { error: e.message });
    return json(401, { error: e instanceof AuthError ? e.message : 'Authentication required.' });
  }

  const apiKey = (process.env.EPREL_API_KEY || '').trim();
  const base = (process.env.EPREL_API_BASE || '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
  const path = (process.env.EPREL_PRODUCT_PATH || '').trim() || DEFAULT_PRODUCT_PATH;
  const keyHeader = (process.env.EPREL_API_KEY_HEADER || '').trim() || DEFAULT_KEY_HEADER;

  // Answered at 200, not as an error, so the Attribute Viewer simply hides the EPREL column on
  // a deploy where the key is not set — rather than showing a failure on every page load. Same
  // contract as jira-status.ts.
  if (!apiKey) {
    return json(200, {
      configured: false,
      reason:
        'EPREL_API_KEY is not set. Request a public API key at ' +
        'https://eprel.ec.europa.eu/screen/requestpublicapikey and set it in the Netlify ' +
        'environment. EPREL_API_BASE, EPREL_PRODUCT_PATH and EPREL_API_KEY_HEADER may also be ' +
        'set if the wiki documents a different shape than the defaults.',
    });
  }

  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  // A dry run that reports the exact URL and header this function WOULD use, so the two
  // unverified pieces can be checked against the EPREL wiki without reading the source. The key
  // itself is never echoed.
  if (body.probe === true) {
    return json(200, {
      configured: true,
      probe: {
        url: base + path.replace('{registration}', '<registration>'),
        keyHeader,
        keySet: true,
      },
    });
  }

  if (!Array.isArray(body.registrations)) {
    return json(400, { error: 'registrations must be an array of EPREL registration numbers.' });
  }

  const requested = [
    ...new Set(
      body.registrations
        .filter((r: unknown): r is string => typeof r === 'string')
        .map((r: string) => r.trim())
        .filter((r: string) => r !== ''),
    ),
  ] as string[];

  if (requested.length > MAX_REGISTRATIONS) {
    return json(400, {
      error: `Too many registrations (${requested.length}); send at most ${MAX_REGISTRATIONS} per request.`,
    });
  }

  if (requested.length === 0) return json(200, { configured: true, results: {} });

  return json(200, { configured: true, results: await inBatches(requested, { base, path, keyHeader, apiKey }) });
};
