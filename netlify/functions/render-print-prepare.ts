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
  loadManuals,
  buildParts,
  leafletLayoutOf,
  AuthError,
  PermanentError,
} from './lib/print-render-shared';
import { findUnresolvedTokens } from '../../src/services/im/im-print-html';

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

    const { manuals, ordered } = await loadManuals(supabase, supabaseUrl, req);

    // Prepare is the cheap gate before any PDFShift credit is spent — fail loudly here
    // rather than silently shipping a defective booklet. 422 is deliberate: it is not in
    // the client's transient-retry set, so these fail immediately with the message.
    //
    // BOTH gates below are production-only. A draft render (template editor, no project)
    // has nothing published to check against, and unresolved tokens are its NORMAL state —
    // per-project values are exactly what a bare template is missing. Blocking there would
    // make the feature refuse every template it exists to preview, so the token check
    // becomes an advisory warning the dialog shows next to the download instead.

    // 1. Every requested language must actually be published (fetchManifestAndManuals
    // silently keeps only the published intersection — refuse instead of printing less
    // than the operator asked for).
    const missing = req.draft ? [] : req.languages.filter((l) => !ordered.includes(l));
    if (missing.length) {
      return json(422, {
        error: `Not published for: ${missing.map((l) => l.toUpperCase()).join(', ')}. ` +
          'Publish the manual for these languages first, or deselect them.',
      });
    }

    // 2. No unresolved {{attribute}} tokens — they would print as literal braces.
    const unresolved = findUnresolvedTokens(manuals);
    const unresolvedSummary = () => {
      const sample = unresolved.slice(0, 5)
        .map((u) => `${u.token} in “${u.section}” (${u.language.toUpperCase()})`)
        .join('; ');
      return `${sample}${unresolved.length > 5 ? ` — and ${unresolved.length - 5} more` : ''}`;
    };
    if (unresolved.length && !req.draft) {
      return json(422, {
        error: `Unresolved values would print as literal text: ${unresolvedSummary()}. ` +
          'Fill the missing values and re-publish before printing.',
      });
    }
    const warnings = unresolved.length
      ? [`${unresolved.length} unresolved value${unresolved.length === 1 ? '' : 's'} will print as literal ` +
         `text (a project fills these in): ${unresolvedSummary()}.`]
      : [];

    const { parts } = buildParts(manuals, req);

    return json(200, {
      partsTotal: parts.length,
      // Advisory only, and only ever populated for a draft — see the gates above.
      warnings,
      // One label per part, for a progress UI. Language body parts carry their code;
      // the shared cover/back parts (full IM only, absent for compact leaflets) sit
      // at the very start/end of the array. The compact two-column leaflet is a single
      // part holding every language, so it is labelled by what it is rather than being
      // mislabelled 'cover' by its position.
      labels:
        leafletLayoutOf(req) === 'compact2col'
          ? parts.map(() => ordered.map((l) => l.toUpperCase()).join('+'))
          : parts.map((p, i) => p.tab?.code ?? (i === 0 ? 'cover' : 'back')),
      ordered,
    });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Print render preparation failed.';
    // Permanent failures (a draft manual missing from tmp, no published language) get 422 —
    // not in the client's transient-retry set, so the job fails immediately with the message.
    if (e instanceof PermanentError) return json(422, { error: message });
    return json(502, { error: message });
  }
};
