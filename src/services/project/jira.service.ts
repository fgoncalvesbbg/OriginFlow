/**
 * Jira status lookup for project launch codes.
 *
 * Read-only and never persisted: every call goes to the Netlify function, which goes
 * to Jira. That is the whole point — a refresh shows Jira's current status, and there
 * is no OriginFlow copy that can go stale. Do not add a `projects.jira_*` column.
 *
 * The API token lives server-side only (see netlify/functions/jira-status.ts); the
 * browser never sees it and cannot call Atlassian directly anyway (no CORS).
 *
 * Failure is always soft. Jira being down, unconfigured, or slow must never break the
 * dashboard, so `lookupJiraIssues` resolves to an empty map and reports the problem
 * through the returned `error` field instead of throwing.
 */

import { auth } from '../../data';
import type { JiraLookup } from '../../types';

const ENDPOINT = '/.netlify/functions/jira-status';
/** Must not exceed MAX_CODES in netlify/functions/jira-status.ts. */
const CHUNK_SIZE = 60;

const ENDPOINT_MISSING_MESSAGE =
  'The Jira endpoint is not being served. Run the app with `netlify dev` — plain `vite` does not serve functions.';

export interface JiraLookupResponse {
  /** False when the server has no Jira credentials — callers should hide the UI entirely. */
  configured: boolean;
  /** Keyed by the exact project code string that was passed in. */
  results: Record<string, JiraLookup>;
  /** Human-readable problem, if any. Present alongside partial results. */
  error?: string;
}

/** Once we know functions aren't served, stop retrying on every render. */
let endpointMissing = false;

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Look up Jira issues for a batch of project codes in one round trip per 60 codes.
 *
 * Batched rather than per-row because the dashboard renders every project at once —
 * one JQL query for the whole page instead of one HTTP call per row.
 *
 * @param codes `Project.projectId` values (the human launch codes, not the uuids).
 * @returns Never rejects. `configured: false` means "Jira isn't set up"; `error` means
 *          "it is set up but the lookup failed" — the caller shows neither as a blocker.
 */
export const lookupJiraIssues = async (codes: string[]): Promise<JiraLookupResponse> => {
  const wanted = Array.from(new Set(codes.filter(c => typeof c === 'string' && c.trim())));
  if (wanted.length === 0) return { configured: true, results: {} };
  if (endpointMissing) return { configured: false, results: {}, error: ENDPOINT_MISSING_MESSAGE };

  // Guarded because callers fire this without awaiting (`void refreshJira(...)`), so a
  // throw here would surface as an unhandled rejection and leave the spinner stuck.
  let token: string | undefined;
  try {
    token = (await auth.getSession())?.accessToken;
  } catch (e: any) {
    return { configured: false, results: {}, error: e?.message || 'Could not read the current session.' };
  }
  if (!token) return { configured: false, results: {}, error: 'You must be signed in to read Jira status.' };

  const results: Record<string, JiraLookup> = {};
  let configured = true;
  let error: string | undefined;

  // Chunks run in parallel: the batches are independent and the function is fast, so
  // a 200-project account still resolves in one round-trip's wall time.
  const responses = await Promise.all(
    chunk(wanted, CHUNK_SIZE).map(async (batch): Promise<Partial<JiraLookupResponse>> => {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ codes: batch }),
        });
        // 404 = the function isn't served at all (it only returns 400/401/405/500/502/200).
        if (res.status === 404) {
          endpointMissing = true;
          return { configured: false, error: ENDPOINT_MISSING_MESSAGE };
        }
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { error: (payload as any)?.error || `Jira lookup failed (${res.status}).` };
        }
        if ((payload as any)?.configured === false) {
          return { configured: false, error: (payload as any)?.reason };
        }
        return { results: (payload as any)?.results || {} };
      } catch (e: any) {
        return { error: e?.message || 'Jira lookup failed.' };
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

/** Single-code convenience for the project detail page. */
export const lookupJiraIssue = async (
  code: string,
): Promise<{ configured: boolean; lookup: JiraLookup | null; error?: string }> => {
  const res = await lookupJiraIssues([code]);
  return { configured: res.configured, lookup: res.results[code] ?? null, error: res.error };
};

/** Shown in place of a status when no Epic carries the project code. Also a filter value. */
export const JIRA_NOT_FOUND_LABEL = 'Not on Jira';

/**
 * The value the dashboard sorts and filters a project's Jira cell on: the Epic's own
 * status name, which is exactly what the chip displays.
 *
 * Deliberately NOT Jira's statusCategory rollup — the PL Epic workflow puts 6 of its 9
 * statuses in the 'indeterminate' bucket, so filtering by category would collapse
 * "RFQ CREATION", "Gates", "PO PLACEMENT" and "PRODUCTION" into one useless option.
 */
export const jiraFilterValue = (lookup: JiraLookup | undefined): string =>
  lookup?.issue?.status || JIRA_NOT_FOUND_LABEL;
