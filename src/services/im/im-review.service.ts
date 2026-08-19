/**
 * Markup.io review client — sends an already-rendered print PDF to Markup.io
 * for a supplier review round (via the send-to-markup Netlify function, which
 * holds the workspace API key) and returns the share link.
 *
 * Review-state model (see migration 111): each send creates a NEW markup, so
 * earlier rounds keep their links and supplier comments. The manual's current
 * round lives in project_ims.review_* and "In Review" is DERIVED — a manual is
 * in review while it is published (status 'generated') and the reviewed version
 * matches the published version. A draft save flips status to 'draft' and a
 * republish bumps the version, so either kind of edit returns the manual to
 * "In Progress" with no clearing write.
 *
 * Feature gating mirrors the print export: the server secret (MARKUPIO_API_KEY)
 * can't be seen by the browser, so the UI is gated on the public flag
 * VITE_MARKUP_REVIEW_ENABLED ("true"), set alongside it.
 */

import { auth } from '../../data';
import type { IMTemplateType } from '../../types';

/** Whether the Markup.io review feature is enabled (server secret configured). */
export const isMarkupReviewAvailable = (): boolean =>
  (import.meta.env.VITE_MARKUP_REVIEW_ENABLED as string | undefined) === 'true';

/** The fields the send-to-markup function needs to identify what to upload. */
export interface SendToMarkupParams {
  projectId: string;
  templateType: IMTemplateType;
  /** im_print_renders.id of the rendered PDF to send. */
  renderId: string;
  /** Display name for the markup in the Markup.io folder. */
  name?: string;
}

export interface MarkupReviewResult {
  markupUrl: string;
  markupId: string;
  reviewRequestedAt: string;
  reviewRequestedBy: string | null;
  reviewVersion: number | null;
  /** Non-fatal server-side problem (the markup exists; recording it failed). */
  warning?: string;
}

const NOT_FOUND_MESSAGE =
  'Review service not found (404). This feature runs as a Netlify function — run the app with ' +
  '`netlify dev` locally (plain `vite`/`npm run start` does not serve functions), or use the ' +
  'deployed site. To hide the button in this environment, set VITE_MARKUP_REVIEW_ENABLED=false.';

/**
 * Upload the given render's PDF to Markup.io and record the review round.
 * Deliberately NO automatic retry: a timeout after the markup was created
 * server-side would create a duplicate markup in the review folder.
 */
export const sendRenderToMarkup = async (params: SendToMarkupParams): Promise<MarkupReviewResult> => {
  const session = await auth.getSession();
  const token = session?.accessToken;
  if (!token) throw new Error('You must be signed in to send a manual for review.');

  let res: Response;
  try {
    res = await fetch('/.netlify/functions/send-to-markup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
      // Generous: the function downloads the PDF from storage and re-uploads it to Markup.io.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error('Sending to Markup.io timed out — check the review folder before retrying, the markup may still have been created.');
    }
    throw new Error(e instanceof Error ? `Sending to Markup.io failed: ${e.message}` : 'Sending to Markup.io failed.');
  }
  if (res.status === 404) throw new Error(NOT_FOUND_MESSAGE);
  if (!res.ok) {
    let message = `Sending to Markup.io failed (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }
  return (await res.json()) as MarkupReviewResult;
};

/** Live state of a manual's current Markup.io review round (see migration 112). */
export interface MarkupReviewStatus {
  /** Raw Markup.io markup status ('editing', 'complete', …; 'deleted' = markup gone). */
  status: string | null;
  /** True when the markup status reads completed/approved OR >=1 explicit approval exists. */
  done: boolean;
  /** Open (unresolved) comment threads; null when the API didn't report a count. */
  activeThreads: number | null;
  /** Explicit approvals (Markup.io projectReviews). */
  approvals: number;
  checkedAt: string;
  /** The markup no longer exists on Markup.io. */
  deleted?: boolean;
  /** Non-fatal server-side problem (status fetched; caching it failed). */
  warning?: string;
}

/**
 * Poll Markup.io (via the markup-review-status function, which holds the API key)
 * for the manual's current review round and cache the outcome on the manual.
 * Throws when the manual was never sent for review (422 from the function).
 */
export const checkMarkupReviewStatus = async (
  projectId: string,
  templateType: IMTemplateType,
): Promise<MarkupReviewStatus> => {
  const session = await auth.getSession();
  const token = session?.accessToken;
  if (!token) throw new Error('You must be signed in to check a review status.');

  let res: Response;
  try {
    res = await fetch('/.netlify/functions/markup-review-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, templateType }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new Error(e instanceof Error ? `Review status check failed: ${e.message}` : 'Review status check failed.');
  }
  if (res.status === 404) throw new Error(NOT_FOUND_MESSAGE);
  if (!res.ok) {
    let message = `Review status check failed (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }
  return (await res.json()) as MarkupReviewStatus;
};
