/**
 * Jira issue lookup for OriginFlow projects (Netlify Function).
 *
 * Answers one question, live, for a batch of project codes: "does this launch code
 * exist in Jira, and what is its status?" Nothing is written to the OriginFlow
 * database — every call hits Jira, so a refresh always shows the truth. There is
 * deliberately no `projects.jira_*` column.
 *
 * WHY a server function: the Jira API token must never reach the browser, and
 * Atlassian Cloud does not send CORS headers that would let the SPA call it directly.
 * This is Pattern A in netlify.toml — same shape as translate.ts.
 *
 * HOW a project code maps to an issue: OriginFlow's `projects.project_id_code` is a
 * free-text launch code (e.g. "MDA26010", "CL26003AU", "Test Pergolas"), NOT a Jira
 * issue key. So we search the configured Jira project for an issue whose SUMMARY
 * contains the code as a whole token, then fall back to a full-text (`text ~`) search
 * for the codes that found nothing. A code that already looks like an issue key
 * ("PL-123") is matched by key instead. See buildJql() / matchIssuesToCodes().
 *
 * Whole-token matching matters: "MDA26016" must not claim "MDA26016AU"'s issue, so
 * the final match is a boundary-anchored regex over the summary, not a substring test.
 *
 * Request body:  { codes: string[] }          (max 60 per call; the client chunks)
 * Response body: {
 *   configured: true,
 *   baseUrl: string,
 *   projectKey: string | null,
 *   results: Record<code, { issue: JiraIssueRef | null, matchCount: number, alternates: JiraIssueRef[] }>
 * }
 * ...or { configured: false, reason } with HTTP 200 when the server env is not set up —
 * the UI then hides the Jira column instead of showing an error on every deploy that
 * has not had the secrets added yet. Genuine failures return { error } with 4xx/5xx.
 *
 * Auth: requires a valid Supabase session (Authorization: Bearer <access_token>),
 * same as translate.ts — this endpoint is on the public internet and exposes internal
 * roadmap data.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed — note vite.config.ts also
 * exposes anything starting with SUPABASE_, so never name a secret that way):
 *   JIRA_BASE_URL      e.g. https://go-bbg.atlassian.net
 *   JIRA_EMAIL         Atlassian account the API token belongs to
 *   JIRA_API_TOKEN     https://id.atlassian.com/manage-profile/security/api-tokens
 *   JIRA_PROJECT_KEY   optional; scopes the search (e.g. PL). Unset = search all projects.
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   session validation
 */

import { createClient } from '@supabase/supabase-js';
import {
  SAFE_CODE,
  buildJql,
  matchIssuesToCodes,
  type CodeResult,
  type JiraSearchIssue,
} from './lib/jira-match';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers?: Record<string, string | undefined>;
}

const MAX_CODES = 60;
/** Jira caps page size at 100; two searches x 100 is well inside the 10s function budget. */
const MAX_RESULTS = 100;
const FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'priority', 'updated', 'duedate'];
/** Leave headroom under Netlify's ~10s synchronous limit so we return a real error, not a 502. */
const JIRA_TIMEOUT_MS = 7000;

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

/**
 * POST a JQL search to Jira Cloud.
 *
 * Atlassian replaced POST /rest/api/3/search with /rest/api/3/search/jql — on
 * go-bbg.atlassian.net the old path now answers 410 Gone — so we call the current
 * endpoint. The 404/405 fallback is for Jira Server / Data Center, which only serves
 * the legacy path. 410 is deliberately NOT a fallback trigger: it means "removed", so
 * retrying the legacy path would just turn one clear error into a confusing one.
 */
const searchJira = async (baseUrl: string, auth: string, jql: string): Promise<JiraSearchIssue[]> => {
  const attempt = async (path: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JIRA_TIMEOUT_MS);
    try {
      return await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jql, fields: FIELDS, maxResults: MAX_RESULTS }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await attempt('/rest/api/3/search/jql');
    if (res.status === 404 || res.status === 405) {
      res = await attempt('/rest/api/3/search');
    }
  } catch (e: any) {
    const message =
      e?.name === 'AbortError' ? 'Jira did not respond in time.' : `Could not reach Jira: ${e?.message || e}`;
    throw Object.assign(new Error(message), { status: 504 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const hint =
      res.status === 401 || res.status === 403
        ? 'Jira rejected the credentials — check JIRA_EMAIL and JIRA_API_TOKEN.'
        : res.status === 400
          ? 'Jira rejected the query — check JIRA_PROJECT_KEY.'
          : `Jira returned ${res.status}.`;
    throw Object.assign(new Error(`${hint}${detail ? ` ${detail.slice(0, 300)}` : ''}`), { status: res.status });
  }

  const data: any = await res.json().catch(() => ({}));
  return Array.isArray(data?.issues) ? data.issues : [];
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }

  // Auth first: never let an unauthenticated caller probe the Jira backlog.
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Authentication required.' });
  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userData?.user) return json(401, { error: 'Invalid or expired session.' });

  const rawBase = (process.env.JIRA_BASE_URL || '').trim().replace(/\/+$/, '');
  const email = (process.env.JIRA_EMAIL || '').trim();
  const apiToken = (process.env.JIRA_API_TOKEN || '').trim();
  const projectKey = (process.env.JIRA_PROJECT_KEY || '').trim();

  // Missing Jira config is NOT an error — the feature is simply off.
  if (!rawBase || !email || !apiToken) {
    return json(200, {
      configured: false,
      reason: 'JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN must be set in the Netlify site environment.',
    });
  }
  if (!/^https:\/\/[^/\s]+$/.test(rawBase)) {
    return json(500, { error: 'JIRA_BASE_URL must be an https origin, e.g. https://your-site.atlassian.net' });
  }
  if (projectKey && !/^[A-Za-z][A-Za-z0-9_]*$/.test(projectKey)) {
    return json(500, { error: 'JIRA_PROJECT_KEY is not a valid Jira project key.' });
  }

  let body: { codes?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!Array.isArray(body.codes)) return json(400, { error: 'codes must be an array of project codes.' });

  // De-duplicate, but key the results by the caller's ORIGINAL string: " CL26002AU" is
  // a real row (leading space) and must come back under the exact key that was sent,
  // while being searched trimmed.
  const requested: { raw: string; code: string }[] = [];
  const seen = new Set<string>();
  for (const c of body.codes) {
    if (typeof c !== 'string') continue;
    const code = c.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    requested.push({ raw: c, code });
  }
  if (requested.length > MAX_CODES) {
    return json(400, { error: `Too many codes (${requested.length}); send at most ${MAX_CODES} per request.` });
  }

  const results: Record<string, CodeResult> = {};
  for (const { raw } of requested) results[raw] = { issue: null, matchCount: 0, alternates: [] };

  const searchable = requested.filter(r => SAFE_CODE.test(r.code));
  const payload = { configured: true, baseUrl: rawBase, projectKey: projectKey || null, results };
  if (searchable.length === 0) return json(200, payload);

  const auth = 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');

  try {
    // Pass 1: summary match — precise, and how launch codes are actually written on tickets.
    const bySummary = await searchJira(rawBase, auth, buildJql(searchable.map(s => s.code), projectKey, 'summary'));
    matchIssuesToCodes(searchable, bySummary, results, rawBase, 'summary');

    // Pass 2: only for codes still unmatched, widen to full text (description, comments).
    const missing = searchable.filter(s => results[s.raw].matchCount === 0);
    if (missing.length > 0) {
      const byText = await searchJira(rawBase, auth, buildJql(missing.map(m => m.code), projectKey, 'text'));
      matchIssuesToCodes(missing, byText, results, rawBase, 'text');
    }
  } catch (e: any) {
    return json(502, { error: e?.message || 'Jira request failed.' });
  }

  return json(200, payload);
};
