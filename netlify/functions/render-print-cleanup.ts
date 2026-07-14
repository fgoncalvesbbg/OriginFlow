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

import { createClient } from '@supabase/supabase-js';
import { NetlifyEvent, BUCKET, tempJobPrefix, AuthError } from './lib/print-render-shared';

interface CleanupRequest {
  projectId: string;
  templateType: string;
  jobId: string;
}

const isValid = (b: unknown): b is CleanupRequest => {
  const r = b as Partial<CleanupRequest>;
  return !!r && typeof r.projectId === 'string' && typeof r.templateType === 'string' && typeof r.jobId === 'string' && !!r.jobId;
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' }) };
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: CleanupRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  if (!isValid(req)) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) };

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new AuthError('Authentication required.');
    const { error: authErr } = await supabase.auth.getUser(token);
    if (authErr) throw new AuthError('Invalid or expired session.');

    const prefix = tempJobPrefix(req.projectId, req.templateType, req.jobId);
    const { data: files, error: listErr } = await supabase.storage.from(BUCKET).list(prefix);
    if (listErr) throw new Error(listErr.message);
    if (files?.length) {
      await supabase.storage.from(BUCKET).remove(files.map((f) => `${prefix}/${f.name}`));
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    if (e instanceof AuthError) return { statusCode: 401, body: JSON.stringify({ error: e.message }) };
    // Non-fatal — see file header. Orphaned tmp/ files can be swept later by a
    // scheduled job if this ever becomes a meaningful storage-cost concern.
    console.error('[render-print-cleanup] cleanup failed (non-fatal):', e);
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};
