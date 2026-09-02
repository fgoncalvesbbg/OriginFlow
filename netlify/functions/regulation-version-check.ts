/**
 * "Is this still the latest version of the standard?" — answered live, for a batch of
 * regulations, against EUR-Lex (Netlify Function).
 *
 * WHY A SERVER FUNCTION: the EUR-Lex SPARQL endpoint sends no CORS headers, so the SPA
 * cannot call it. There is no credential involved — the endpoint is public — so unlike
 * translate.ts / jira-status.ts this function guards access rather than a secret. It still
 * requires a valid Supabase session, because it is an unauthenticated fan-out to a third
 * party from our origin and an open one is an abuse vector, not because the data is secret.
 *
 * SCOPE, STATED PLAINLY: this covers EU legal acts only — Directives, Regulations and
 * Decisions, identified by CELEX. EN, IEC and ISO standards are NOT covered and cannot be:
 * CENELEC and IEC publish no free catalogue API (IEC's api-portal.iec.ch is account-gated),
 * so a regulation with no `celex_id` comes back `not_found` with `checkable: false` and is
 * version-tracked by `source_url` + `review_due_at` and a person instead. Reporting that
 * honestly is the point — silently returning "current" for a standard nobody checked is
 * exactly the failure a compliance tool must not have.
 *
 * The function only READS. It returns verdicts; persisting them onto `regulations` is the
 * client's job through the normal RLS-checked path, so this function needs no write
 * privilege and cannot corrupt the library if it misreads a response.
 *
 * Request body:  { regulations: [{ id, celex, known?: 'yyyy-mm-dd' }] }   (max 60)
 *   `known` is the newest date the caller already records (last_amended_at ?? issued_at).
 * Response body: { results: Record<regulationId, VersionCheckResult> }
 *
 * Server env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (session validation only).
 */

import { createClient } from '@supabase/supabase-js';

import {
  EURLEX_SPARQL_ENDPOINT,
  buildVersionQuery,
  decideState,
  parseVersionResults,
  type EurLexFacts,
  type VersionState,
} from './lib/eurlex';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers?: Record<string, string | undefined>;
}

const MAX_REGULATIONS = 60;
/** Leave headroom under Netlify's ~10s synchronous limit so we return a real error, not a 502. */
const SPARQL_TIMEOUT_MS = 8000;
/** CELEX as CELLAR stores it: sector digit, 4-digit year, act letter(s), 4-digit number. */
const SAFE_CELEX = /^[0-9][0-9]{4}[A-Z]{1,2}[0-9]{4}(\([0-9]{2}\))?$/;

interface VersionCheckResult {
  state: VersionState;
  /** false when the regulation has no CELEX — a standard we structurally cannot check. */
  checkable: boolean;
  celex: string | null;
  detail: (Partial<EurLexFacts> & { source: 'eurlex' }) | null;
  message?: string;
}

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

const querySparql = async (query: string): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPARQL_TIMEOUT_MS);
  try {
    // GET with the query in the URL: the endpoint accepts it, and it keeps the call
    // trivially reproducible with curl when someone is debugging a wrong verdict.
    const url = `${EURLEX_SPARQL_ENDPOINT}?${new URLSearchParams({
      query,
      format: 'application/sparql-results+json',
    })}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/sparql-results+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(
        new Error(`EUR-Lex returned ${res.status}.${detail ? ` ${detail.slice(0, 200)}` : ''}`),
        { status: res.status >= 500 ? 502 : res.status },
      );
    }
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw Object.assign(new Error('EUR-Lex did not respond in time.'), { status: 504 });
    }
    if (e?.status) throw e;
    throw Object.assign(new Error(`Could not reach EUR-Lex: ${e?.message || e}`), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Authentication required.' });
  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userData?.user) return json(401, { error: 'Invalid or expired session.' });

  let body: { regulations?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!Array.isArray(body.regulations)) {
    return json(400, { error: 'regulations must be an array of { id, celex, known }.' });
  }
  if (body.regulations.length > MAX_REGULATIONS) {
    return json(400, {
      error: `Too many regulations (${body.regulations.length}); send at most ${MAX_REGULATIONS} per request.`,
    });
  }

  const requested = body.regulations
    .filter((r: any) => r && typeof r.id === 'string' && r.id)
    .map((r: any) => ({
      id: r.id as string,
      celex: typeof r.celex === 'string' ? r.celex.trim().toUpperCase() : '',
      known: typeof r.known === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.known) ? r.known : null,
    }));

  const results: Record<string, VersionCheckResult> = {};

  // A regulation with no usable CELEX is answered without asking EUR-Lex anything. It is
  // not an error and not "current" — it is a row nothing can check automatically.
  const checkable = requested.filter(r => {
    if (SAFE_CELEX.test(r.celex)) return true;
    results[r.id] = {
      state: 'not_found',
      checkable: false,
      celex: r.celex || null,
      detail: null,
      message: r.celex
        ? `"${r.celex}" is not a CELEX number, so EUR-Lex cannot be queried for it.`
        : 'No CELEX number. EN, IEC and ISO standards have no free catalogue API — track this one by its source link and review date.',
    };
    return false;
  });

  if (checkable.length === 0) return json(200, { results });

  // One round trip for the whole batch — the query is a VALUES list, not N queries.
  let facts: Map<string, EurLexFacts>;
  try {
    const raw = await querySparql(buildVersionQuery(checkable.map(r => r.celex)));
    facts = parseVersionResults(raw);
  } catch (e: any) {
    // A source that could not be reached is reported AS unreachable on every row it
    // covered. Degrading to "current" here would be the one lie this endpoint must never
    // tell, so the state is 'error' and the caller shows it as unknown.
    for (const r of checkable) {
      results[r.id] = {
        state: 'error',
        checkable: true,
        celex: r.celex,
        detail: null,
        message: e?.message || 'EUR-Lex could not be reached.',
      };
    }
    return json(200, { results });
  }

  for (const r of checkable) {
    const f = facts.get(r.celex);
    results[r.id] = {
      state: decideState(f, r.known),
      checkable: true,
      celex: r.celex,
      detail: f ? { ...f, source: 'eurlex' } : null,
      message: f ? undefined : `EUR-Lex has no document with CELEX ${r.celex}.`,
    };
  }

  return json(200, { results });
};
