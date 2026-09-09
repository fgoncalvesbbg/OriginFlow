/**
 * SOP & Documents — the download route (Netlify Function).
 *
 *   GET /api/doc-versions/:versionId/download   one specific version
 *   GET /api/documents/:documentId/latest       the document's CURRENT final version
 *
 * Both do the same five things, in this order, every time:
 *
 *   authenticate  ->  rate limit  ->  entitlement check  ->  mint a 120s signed URL
 *                 ->  log the access  ->  302 redirect
 *
 * WHY A REDIRECT AND NOT THE BYTES
 * ---------------------------------
 * Proxying the PDF through this function would put a 25 MB transfer inside a synchronous
 * function invocation with a ~10s budget, and would bill the egress twice. The redirect
 * hands the transfer to Storage, which is built for it.
 *
 * WHAT THE CLIENT NEVER RECEIVES
 * -------------------------------
 * Not the storage key, not a long-lived URL, not the bucket name. The signed URL exists
 * for 120 seconds and appears only in the `Location` header of a response the browser
 * follows immediately. `Referrer-Policy: no-referrer` is set on that response so the
 * signed URL cannot leak onward through a `Referer` header, and `Cache-Control: no-store`
 * keeps it out of any intermediary.
 *
 * THE FRIENDLY FILENAME
 * ----------------------
 * `Content-Disposition` is set on this 302, but browsers ignore headers on a redirect —
 * so the name that actually reaches the user comes from the `download` option passed to
 * createSignedUrl, which makes Storage itself emit the header on the response that
 * carries the bytes. The header here is for non-browser clients that stop at the 302.
 *
 * THE STABLE TEMPLATE ROUTE
 * --------------------------
 * /api/documents/:id/latest is the "get me the latest template" link: it is safe to paste
 * into a wiki or an email because it names the DOCUMENT, not a version, and resolves to
 * whatever is final at the moment it is clicked. Un-finalising a version breaks the link
 * (404) rather than serving a withdrawn document — which is the intended behaviour.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { NetlifyEvent, serviceClient } from './lib/http';
import {
  DOC_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  VERSION_COLUMNS,
  DOCUMENT_COLUMNS,
  type Caller,
  type DocumentRow,
  type VersionRow,
  DocAuthError,
  DocNotFoundError,
  DocValidationError,
  assertDocUuid,
  bindingProjectIds,
  callerFromTicket,
  clientIp,
  docJson,
  friendlyFilename,
  handleDocError,
  isInternal,
  loadEntitledVersion,
  rateLimit,
  rateLimitKey,
  resolveCaller,
  supplierMaySeeVersion,
} from './lib/doc-access';

/** 60 downloads a minute per caller. A human clicking links never approaches it; a script
 *  enumerating version ids hits it immediately — and every attempt is already a 404 for a
 *  version it is not entitled to, so this caps the cost of the probing, not the leak. */
const DOWNLOAD_LIMIT = 60;
const DOWNLOAD_WINDOW_SECONDS = 60;

interface ParsedRoute {
  kind: 'version' | 'latest';
  id: string;
}

/**
 * Accepts the friendly paths and the raw function paths alike — `netlify dev` and a
 * direct /.netlify/functions/ call do not go through the redirect rules, and a route that
 * only works behind the rewrite is a route that cannot be tested locally.
 */
const parseRoute = (path: string): ParsedRoute | null => {
  const version = path.match(/\/(?:api\/doc-versions|doc-download\/versions)\/([^/]+)\/download\/?$/);
  if (version) return { kind: 'version', id: decodeURIComponent(version[1]) };

  const latest = path.match(/\/(?:api\/documents|doc-download\/documents)\/([^/]+)\/latest\/?$/);
  if (latest) return { kind: 'latest', id: decodeURIComponent(latest[1]) };

  return null;
};

/**
 * The current final version of a document, subject to the caller's entitlement.
 *
 * Written as its own query rather than "list versions then filter" so the database's
 * unique partial index (one final per document) is what decides which row this is.
 */
const loadEntitledFinalVersion = async (
  supabase: ReturnType<typeof serviceClient>,
  documentId: string,
  caller: Caller,
): Promise<{ version: VersionRow; document: DocumentRow }> => {
  const { data: document, error: docErr } = await supabase
    .from('doc_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', documentId)
    .maybeSingle();

  if (docErr) {
    console.error('[doc-download] document lookup failed:', docErr);
    throw new Error('Could not load this document.');
  }
  // 404 rather than 403 for an internal document seen by a supplier: see loadEntitledVersion.
  if (!document) throw new DocNotFoundError('No such document.');
  const doc = document as unknown as DocumentRow;

  const { data: version, error: verErr } = await supabase
    .from('doc_versions')
    .select(VERSION_COLUMNS)
    .eq('document_id', documentId)
    .eq('is_final', true)
    .maybeSingle();

  if (verErr) {
    console.error('[doc-download] final version lookup failed:', verErr);
    throw new Error('Could not load this document.');
  }
  if (!version) throw new DocNotFoundError('This document has no released version yet.');
  const row = version as unknown as VersionRow;

  if (!isInternal(caller)) {
    const allowed = supplierMaySeeVersion({
      document: doc,
      version: row,
      boundProjectIds: await bindingProjectIds(supabase, doc.id),
      supplierProjectIds: caller.projectIds,
    });
    if (!allowed) throw new DocNotFoundError('No such document.');
  }

  return { version: row, document: doc };
};

/**
 * Claim a single-use ticket and turn it back into a caller.
 *
 * Two checks beyond "the ticket exists": it must not already have been used or expired
 * (the claim is a single atomic UPDATE, so a double-click redeems once), and — for a
 * per-version download — it must be a ticket for THIS version. A ticket is scoped to one
 * document's release; without the second check, a supplier holding a valid ticket for
 * their packaging guideline could redeem it against any version id they cared to type.
 *
 * A /latest request skips the version comparison because the ticket is minted against
 * whatever was final at the time, and the caller it returns is re-authorized against the
 * live registry anyway.
 */
const callerFromClaimedTicket = async (
  supabase: ReturnType<typeof serviceClient>,
  token: string,
  route: ParsedRoute,
) => {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
    throw new DocAuthError('This download link is not valid.');
  }

  const { data, error } = await supabase.rpc('doc_claim_download_ticket', { p_token: token });
  if (error) {
    console.error('[doc-download] ticket claim failed:', error);
    throw new Error('Could not verify this download link.');
  }

  const ticket = (Array.isArray(data) ? data[0] : data) as
    | { version_id: string; user_id: string | null; supplier_id: string | null }
    | null;

  // One message for unknown, already-used and expired alike, so redeeming a stolen ticket
  // cannot be distinguished from guessing one.
  if (!ticket?.version_id) {
    throw new DocAuthError('This download link has expired. Please try again.');
  }
  if (route.kind === 'version' && ticket.version_id !== route.id) {
    throw new DocAuthError('This download link is not valid.');
  }

  return callerFromTicket(supabase, ticket);
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'GET') return docJson(405, { error: 'Method not allowed' });

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return docJson(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  try {
    const route = parseRoute(event.path ?? '');
    if (!route) throw new DocValidationError('Unknown download route.');
    assertDocUuid(route.id, route.kind === 'version' ? 'versionId' : 'documentId');

    // Two ways in. A ticket is what a browser NAVIGATION uses (see the doc_download_tickets
    // header in migration 159); headers are what a fetch or a script uses. Either way the
    // result is a Caller, and everything after this line is identical for both.
    const ticketToken = event.queryStringParameters?.ticket;
    const caller = ticketToken
      ? await callerFromClaimedTicket(supabase, ticketToken, route)
      : await resolveCaller(event, supabase);

    await rateLimit(
      supabase,
      rateLimitKey('doc-download', caller),
      DOWNLOAD_LIMIT,
      DOWNLOAD_WINDOW_SECONDS,
    );

    const { version, document } =
      route.kind === 'version'
        ? await loadEntitledVersion(supabase, route.id, caller)
        : await loadEntitledFinalVersion(supabase, route.id, caller);

    // Entitled, but there is nothing to serve. Distinct from "not entitled", and safe to
    // say so: the caller has already been proven able to see this version.
    if (!version.pdf_storage_path) {
      throw new DocNotFoundError('No released PDF has been uploaded for this version yet.');
    }

    const filename = friendlyFilename(document.title, version.label);

    const { data: signed, error: signErr } = await supabase.storage
      .from(DOC_BUCKET)
      .createSignedUrl(version.pdf_storage_path, SIGNED_URL_TTL_SECONDS, { download: filename });

    if (signErr || !signed?.signedUrl) {
      console.error('[doc-download] createSignedUrl failed:', signErr);
      return docJson(500, { error: 'Could not create a download link.' });
    }

    // Logged BEFORE the redirect is returned, and a failure to log is logged but does not
    // block the download: the access log is an audit record, not a gate, and refusing a
    // supplier their packaging spec because an insert failed helps nobody.
    const { error: logErr } = await supabase.from('doc_access_log').insert({
      version_id: version.id,
      user_id: isInternal(caller) ? caller.userId : null,
      supplier_id: isInternal(caller) ? null : caller.supplierId,
      ip: clientIp(event),
    });
    if (logErr) console.error('[doc-download] access log insert failed:', logErr);

    return {
      statusCode: 302,
      headers: {
        Location: signed.signedUrl,
        // The signed URL must not travel onward in a Referer header, and must not sit in
        // any cache. Both matter more here than on an ordinary redirect because the URL
        // IS the credential for the next 120 seconds.
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store, private',
        // Ignored by browsers on a 302 (Storage emits the real one, see the file header),
        // present for curl/wget and anything else that stops at the redirect.
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: '',
    };
  } catch (e) {
    return handleDocError(e);
  }
};
