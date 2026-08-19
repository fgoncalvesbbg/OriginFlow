/**
 * markup-review-status — polls Markup.io for the state of a manual's current
 * review round and caches the outcome on project_ims (migration 112).
 *
 * Why a function: the Markup.io workspace API key is a server-only secret (same
 * as send-to-markup), and the cached outcome must be written with the service
 * role so every viewer sees the same review state.
 *
 * Flow: authenticate → load the manual's review_markup_id → GET
 * /api/v2/markups/{id} → derive "done" → cache review_status/review_done/
 * review_active_threads/review_approvals/review_checked_at → return the state.
 *
 * "Done" derivation (see the Markup.io Admin API's markup resource): the markup
 * carries a workspace status enum (the app's No Status / Open for Review /
 * Editing Content / On Hold / Completed — only 'editing' is shown in the API
 * examples, so the match is defensive), an `activeThreads` count (open comment
 * threads), and `projectReviews` (explicit approvals). A review round counts as
 * done when the status reads completed/approved/done OR at least one explicit
 * approval exists. Thread counts are progress, not a done-signal — zero open
 * threads also describes a markup nobody has looked at.
 */

import { createClient } from '@supabase/supabase-js';
import { AuthError, NetlifyEvent, PermanentError, authenticate, json } from './lib/print-render-shared';

const MARKUP_API_BASE = 'https://api.markup.io/api/v2/markups';
const MARKUP_API_VERSION = '2023-02-22';

interface ReviewStatusRequest {
  projectId: string;
  templateType: 'im' | 'warning_leaflet';
}

const isValidRequest = (b: unknown): b is ReviewStatusRequest => {
  const r = b as Partial<ReviewStatusRequest>;
  return !!r && typeof r.projectId === 'string'
    && (r.templateType === 'im' || r.templateType === 'warning_leaflet');
};

/** True when a Markup.io status string reads as a finished review. */
const isDoneStatus = (status: string | null | undefined): boolean =>
  !!status && /complet|approv|\bdone\b/i.test(status);

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.MARKUPIO_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return json(500, { error: 'MARKUPIO_API_KEY is not configured on the server.' });
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: ReviewStatusRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidRequest(req)) return json(400, { error: 'Invalid request body.' });

  try {
    await authenticate(supabase, event);

    const { data: im, error: imErr } = await supabase
      .from('project_ims')
      .select('id, review_markup_id')
      .eq('project_id', req.projectId)
      .eq('template_type', req.templateType)
      .maybeSingle();
    if (imErr) throw new Error(`Could not load the manual (${imErr.message}).`);
    if (!im) throw new PermanentError('No manual exists for this project/type.');
    if (!im.review_markup_id) throw new PermanentError('This manual was never sent to Markup.io for review.');

    const checkedAt = new Date().toISOString();
    const res = await fetch(`${MARKUP_API_BASE}/${encodeURIComponent(im.review_markup_id)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Markup-API-Version': MARKUP_API_VERSION },
    });

    // The markup was deleted on Markup.io — a real state worth caching, not an error.
    if (res.status === 404 || res.status === 410) {
      await supabase.from('project_ims').update({
        review_status: 'deleted', review_done: false,
        review_active_threads: null, review_approvals: null, review_checked_at: checkedAt,
      }).eq('id', im.id);
      return json(200, { status: 'deleted', done: false, deleted: true, activeThreads: null, approvals: 0, checkedAt });
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const message = `Markup.io status check failed (${res.status}): ${detail.slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new PermanentError(message);
      }
      throw new Error(message);
    }

    // Accept both bare and { data: … }-wrapped shapes, like send-to-markup does.
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const markup = ((body?.data ?? body) ?? {}) as {
      status?: string;
      activeThreads?: number;
      projectReviews?: unknown[];
      deletedAt?: string | null;
    };

    const status = markup.deletedAt ? 'deleted' : (markup.status ?? null);
    const activeThreads = typeof markup.activeThreads === 'number' ? markup.activeThreads : null;
    const approvals = Array.isArray(markup.projectReviews) ? markup.projectReviews.length : 0;
    const done = !markup.deletedAt && (isDoneStatus(status) || approvals > 0);

    // Cache best-effort — a failed write must not fail the check (the caller still
    // gets the live answer; the next check retries the cache).
    const warnings: string[] = [];
    const { error: upErr } = await supabase.from('project_ims').update({
      review_status: status,
      review_done: done,
      review_active_threads: activeThreads,
      review_approvals: approvals,
      review_checked_at: checkedAt,
    }).eq('id', im.id);
    if (upErr) warnings.push(`the cached review state could not be written (${upErr.message})`);

    return json(200, {
      status, done, activeThreads, approvals, checkedAt,
      ...(markup.deletedAt ? { deleted: true } : {}),
      ...(warnings.length ? { warning: `Status fetched, but ${warnings.join('; ')}.` } : {}),
    });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Review status check failed.';
    if (e instanceof PermanentError) return json(422, { error: message });
    return json(502, { error: message });
  }
};
