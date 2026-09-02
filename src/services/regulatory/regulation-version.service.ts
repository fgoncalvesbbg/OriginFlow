/**
 * "Is this still the latest version?" — the client half.
 *
 * Unlike the Jira lookup (which is live-only and deliberately never persisted), a version
 * verdict IS written back onto the regulation. The difference is what the answer is for:
 * a Jira status is read while you look at it, whereas "a newer consolidation of the LVD
 * exists" is a standing fact about the library that a person has to act on, possibly weeks
 * later. Persisting it means opening the library shows every badge instantly with no
 * fan-out, and `version_checked_at` can say honestly how old that judgement is.
 *
 * Failure is always soft and always visible. If EUR-Lex is unreachable the row is marked
 * 'error', never left looking checked — see netlify/functions/regulation-version-check.ts
 * for why degrading to "current" is the one lie this feature must not tell.
 *
 * COVERAGE, so nobody reads a green badge as more than it is: only EU legal acts have a
 * CELEX and can be checked. EN/IEC/ISO standards come back `checkable: false` and are
 * tracked by `sourceUrl` + `reviewDueAt` and a person.
 */

import { auth, db } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  Regulation,
  RegulationVersionDetail,
  RegulationVersionResult,
  RegulationVersionState,
} from '../../types';

const ENDPOINT = '/.netlify/functions/regulation-version-check';
/** Must not exceed MAX_REGULATIONS in netlify/functions/regulation-version-check.ts. */
const CHUNK_SIZE = 60;

const ENDPOINT_MISSING_MESSAGE =
  'The version-check endpoint is not being served. Run the app with `netlify dev` — plain `vite` does not serve functions.';

export interface VersionCheckOutcome {
  /** One entry per regulation that was actually checked (i.e. had a CELEX). */
  results: Record<string, RegulationVersionResult>;
  /** Regulation ids skipped because they carry no CELEX — standards, guides, nicknames. */
  skipped: string[];
  /** Human-readable problem. Present alongside partial results; never thrown. */
  error?: string;
}

/** The newest date we already record for a regulation — the baseline the check compares to. */
export const knownVersionDate = (r: Regulation): string | null =>
  r.lastAmendedAt || r.issuedAt || null;

/** How stale a verdict is, in days, or null when it was never checked. */
export const versionCheckAgeDays = (r: Regulation, now = Date.now()): number | null => {
  if (!r.versionCheckedAt) return null;
  const t = Date.parse(r.versionCheckedAt);
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
};

/** True when a person is overdue to re-verify a row nothing can check automatically. */
export const isReviewOverdue = (r: Regulation, today = new Date().toISOString().slice(0, 10)): boolean =>
  !!r.reviewDueAt && r.reviewDueAt <= today;

/**
 * Run the check for a set of regulations and persist each verdict.
 *
 * Writes go through the normal RLS path, so a non-admin gets the verdicts back but the
 * write is refused — which is why a failed persist is collected into `error` rather than
 * thrown: seeing the answer is useful even when you are not allowed to record it.
 */
export const runVersionCheck = async (regulations: Regulation[]): Promise<VersionCheckOutcome> => {
  const results: Record<string, RegulationVersionResult> = {};
  const skipped: string[] = [];

  const checkable = regulations.filter(r => {
    if (r.celexId && r.celexId.trim()) return true;
    skipped.push(r.id);
    return false;
  });
  if (checkable.length === 0) return { results, skipped };
  if (!isLive) return { results, skipped, error: 'Version checks need a live database connection.' };

  let token: string | undefined;
  try {
    token = (await auth.getSession())?.accessToken;
  } catch (e: any) {
    return { results, skipped, error: e?.message || 'Could not read the current session.' };
  }
  if (!token) return { results, skipped, error: 'You must be signed in to run a version check.' };

  const byId = new Map(checkable.map(r => [r.id, r]));
  let error: string | undefined;

  for (let i = 0; i < checkable.length; i += CHUNK_SIZE) {
    const batch = checkable.slice(i, i + CHUNK_SIZE);
    let payload: any;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          regulations: batch.map(r => ({
            id: r.id,
            celex: r.celexId,
            known: knownVersionDate(r),
          })),
        }),
      });
      if (res.status === 404) return { results, skipped, error: ENDPOINT_MISSING_MESSAGE };
      payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = payload?.error || `Version check failed (${res.status}).`;
        continue;
      }
    } catch (e: any) {
      error = e?.message || 'Version check failed.';
      continue;
    }

    for (const [id, raw] of Object.entries<any>(payload?.results ?? {})) {
      const reg = byId.get(id);
      if (!reg) continue;
      if (raw?.checkable === false) { skipped.push(id); continue; }

      const detail: RegulationVersionDetail = { source: 'eurlex', celex: raw?.celex ?? undefined, ...(raw?.detail ?? {}) };
      results[id] = {
        regulationId: id,
        celex: raw?.celex ?? reg.celexId ?? '',
        state: (raw?.state ?? 'error') as RegulationVersionState,
        detail,
        // Offered for the operator to accept, never written silently: EUR-Lex's date is
        // authoritative about the ACT, but which edition this row is meant to describe is
        // a decision, not a fact.
        suggestedIssuedAt: !reg.issuedAt ? detail.documentDate : undefined,
        suggestedLastAmendedAt: detail.lastAmendedOn && detail.lastAmendedOn !== reg.lastAmendedAt
          ? detail.lastAmendedOn : undefined,
        suggestedVersion: detail.latestConsolidatedOn
          ? `consolidated ${detail.latestConsolidatedOn}` : undefined,
      };
    }
  }

  // Persist the verdicts. One upsert per row — there are tens of regulations, not
  // thousands, and a partial failure must leave the successful rows recorded.
  const checkedAt = new Date().toISOString();
  for (const r of Object.values(results)) {
    try {
      await db.updateWhere('regulations', {
        version_state: r.state,
        version_checked_at: checkedAt,
        version_detail: r.detail,
        updated_at: checkedAt,
      }, { where: { id: r.regulationId } });
    } catch (e: any) {
      error = error || `The check ran, but the result could not be saved: ${e?.message || e}`;
    }
  }

  return { results, skipped, error };
};
