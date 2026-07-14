/**
 * Print-PDF pipeline, step 1/4: PREPARE (Netlify Function).
 *
 * Resolves the published manifest + manuals and builds the booklet's HTML parts
 * (cheap — no PDFShift calls) purely to report how many parts there are and what
 * each one is, so the client knows how many `render-print-part` calls to make and
 * can show real progress ("Rendering DE (3/12)…").
 *
 * See netlify/functions/lib/print-render-shared.ts for why this pipeline is split
 * across four functions instead of one.
 */

import { createClient } from '@supabase/supabase-js';
import {
  NetlifyEvent,
  RenderRequestBase,
  isValidBase,
  json,
  fetchManifestAndManuals,
  buildParts,
  AuthError,
} from './lib/print-render-shared';

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: RenderRequestBase;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidBase(req)) return json(400, { error: 'Invalid request body.' });

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new AuthError('Authentication required.');
    const { error: authErr } = await supabase.auth.getUser(token);
    if (authErr) throw new AuthError('Invalid or expired session.');

    const { manuals, ordered } = await fetchManifestAndManuals(supabaseUrl, req);
    const { parts } = buildParts(manuals, req);

    return json(200, {
      partsTotal: parts.length,
      // One label per part, for a progress UI. Language body parts carry their code;
      // the shared cover/back parts (full IM only, absent for compact leaflets) sit
      // at the very start/end of the array.
      labels: parts.map((p, i) => p.tab?.code ?? (i === 0 ? 'cover' : 'back')),
      ordered,
    });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Print render preparation failed.';
    return json(502, { error: message });
  }
};
