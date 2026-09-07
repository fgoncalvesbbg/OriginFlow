/**
 * Print-PDF pipeline, step 4/4: CLEANUP (Netlify Function).
 *
 * Deletes a job's intermediate part PDFs from temp storage. Called by the
 * client in a `finally` block after every job (success or failure), so
 * temp files never accumulate. Best-effort: a cleanup failure is logged but
 * still reported as success to the caller — it must never surface as a
 * render failure, since the actual render/merge already succeeded or failed
 * on its own terms by the time cleanup runs.
 */

import {
  NetlifyEvent,
  json,
  serviceClient,
  authenticate,
  authorizeProject,
  assertJobId,
  AuthError,
  ForbiddenError,
  ValidationError,
} from './lib/http';
import { BUCKET, tempJobPrefix, assertRenderProjectId } from './lib/print-render-shared';

interface CleanupRequest {
  projectId: string;
  templateType: string;
  jobId: string;
}

const isValid = (b: unknown): b is CleanupRequest => {
  const r = b as Partial<CleanupRequest>;
  return (
    !!r &&
    typeof r.projectId === 'string' &&
    (r.templateType === 'im' || r.templateType === 'warning_leaflet') &&
    typeof r.jobId === 'string' && !!r.jobId
  );
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  let req: CleanupRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValid(req)) return json(400, { error: 'Invalid request body.' });

  try {
    // Every parameter interpolated into a Storage key is validated before it is used.
    // Draftness is derived from the id's own shape (see assertRenderProjectId) — this
    // request has no explicit `draft` flag of its own to trust.
    const { value: projectId, isDraft } = assertRenderProjectId(req.projectId);
    assertJobId(req.jobId);

    // AUTHORIZATION, not just authentication — see render-print-prepare.ts's comment.
    if (isDraft) await authenticate(event);
    else await authorizeProject(event, projectId);

    const prefix = tempJobPrefix(projectId, req.templateType, req.jobId);
    const { data: files, error: listErr } = await supabase.storage.from(BUCKET).list(prefix);
    if (listErr) throw new Error(listErr.message);
    if (files?.length) {
      await supabase.storage.from(BUCKET).remove(files.map((f) => `${prefix}/${f.name}`));
    }
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    if (e instanceof ForbiddenError) return json(403, { error: e.message });
    if (e instanceof ValidationError) return json(400, { error: e.message });
    // Non-fatal — see file header. Orphaned tmp/ files can be swept later by a
    // scheduled job if this ever becomes a meaningful storage-cost concern. Never
    // echoed to the caller — just logged, same as before.
    console.error('[render-print-cleanup] cleanup failed (non-fatal):', e);
    return json(200, { ok: false });
  }
};
