/**
 * SOP & Documents — the project-scoped document list (Netlify Function).
 *
 *   GET /api/doc-portal/project-documents[?projectId=...]
 *
 * This is the ONE list route a supplier can reach, and it is what the Documents tab on
 * the supplier project page renders. Internal users hit the same route for the same tab
 * inside ProjectDetail, which is deliberate: two implementations of "what applies to this
 * project" would eventually disagree about one of them, and the one that would be wrong
 * is the one a supplier sees.
 *
 * WHAT A SUPPLIER GETS BACK
 * --------------------------
 * Only documents that satisfy all three clauses of the visibility rule
 * (`supplierMaySeeVersion`): a FINAL version, of a document whose audience is 'supplier',
 * bound to a project the caller's portal credential actually speaks for. Each one carries
 * the whitelisted `SupplierVersionDto` — no sharepoint_link, no storage path, no
 * non-final versions, not even a count of them.
 *
 * A document bound to the project whose current version has been un-finalised simply is
 * not in the response. That is the un-finalise button working: the rule is evaluated on
 * every request, so removal is immediate and there is no cache to invalidate.
 *
 * WHAT AN INTERNAL USER GETS BACK
 * --------------------------------
 * Everything bound to the project, internal-audience documents included, with the
 * internal DTO. `projectId` is required for them (they have no implicit project) and is
 * authorized through `authorizeProject`, so PM scoping applies.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) — for the caller-scoped project check
 */

import { randomBytes } from 'crypto';
import {
  NetlifyEvent,
  serviceClient,
  authorizeProject,
  AuthError,
  ForbiddenError,
} from './lib/http';
import {
  DOCUMENT_COLUMNS,
  VERSION_COLUMNS,
  type Caller,
  type DocumentRow,
  type VersionRow,
  DocForbiddenError,
  DocValidationError,
  assertDocUuid,
  docJson,
  handleDocError,
  isInternal,
  loadEntitledVersion,
  rateLimit,
  rateLimitKey,
  resolveCaller,
  toInternalDocumentDto,
  toInternalVersionDto,
  toSupplierDocumentDto,
  toSupplierVersionDto,
} from './lib/doc-access';

/** Generous for a page that loads once per portal visit, tight enough to cap scraping. */
const LIST_LIMIT = 120;
const LIST_WINDOW_SECONDS = 60;

/** 60 seconds: long enough for the navigation the click triggers, not long enough to share. */
const TICKET_TTL_SECONDS = 60;

type Supabase = ReturnType<typeof serviceClient>;

/**
 * Mint a single-use download ticket: POST /api/doc-portal/download-ticket { versionId }.
 *
 * This exists so a BROWSER can navigate to the download route — a navigation cannot carry
 * an Authorization or x-portal-token header, and a fetch cannot follow the cross-origin
 * redirect to Storage while carrying one either. See the doc_download_tickets header in
 * migration 159.
 *
 * The full entitlement check runs HERE as well as on redemption. Minting a ticket for a
 * version the caller cannot see would otherwise be a way to launder a 404 into a valid
 * credential — and the double check costs one query on a path that runs once per click.
 */
const mintDownloadTicket = async (supabase: Supabase, event: NetlifyEvent, caller: Caller) => {
  let body: { versionId?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    throw new DocValidationError('Invalid JSON body.');
  }
  const versionId = assertDocUuid(body.versionId, 'versionId');

  // Throws DocNotFoundError for anything this caller is not entitled to — the same 404 a
  // direct download attempt would get, so minting leaks nothing a download would not.
  await loadEntitledVersion(supabase, versionId, caller);

  const token = randomBytes(32).toString('base64url');
  const { error } = await supabase.from('doc_download_tickets').insert({
    token,
    version_id: versionId,
    user_id: isInternal(caller) ? caller.userId : null,
    supplier_id: isInternal(caller) ? null : caller.supplierId,
    expires_at: new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) {
    console.error('[doc-portal] ticket insert failed:', error);
    throw new Error('Could not prepare the download.');
  }

  return docJson(201, {
    ticket: token,
    // A relative path, so the browser navigates to our own origin and the ticket never
    // travels to a third party.
    url: `/api/doc-versions/${versionId}/download?ticket=${encodeURIComponent(token)}`,
    expiresInSeconds: TICKET_TTL_SECONDS,
  });
};

export const handler = async (event: NetlifyEvent) => {
  const isTicketRequest = /download-ticket\/?$/.test(event.path ?? '');
  if (event.httpMethod !== 'GET' && !(event.httpMethod === 'POST' && isTicketRequest)) {
    return docJson(405, { error: 'Method not allowed' });
  }

  let supabase: Supabase;
  try {
    supabase = serviceClient();
  } catch (e) {
    return docJson(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  try {
    const caller = await resolveCaller(event, supabase);
    await rateLimit(supabase, rateLimitKey('doc-portal', caller), LIST_LIMIT, LIST_WINDOW_SECONDS);

    if (isTicketRequest) return await mintDownloadTicket(supabase, event, caller);

    const requestedProjectId = event.queryStringParameters?.projectId;

    // ── Which projects is this response about ────────────────────────────────────────
    let projectIds: string[];

    if (isInternal(caller)) {
      if (!requestedProjectId) throw new DocValidationError('projectId is required.');
      const projectId = assertDocUuid(requestedProjectId, 'projectId');
      try {
        await authorizeProject(event, projectId);
      } catch (e) {
        if (e instanceof ForbiddenError) throw new DocForbiddenError('You do not have access to this project.');
        throw e;
      }
      projectIds = [projectId];
    } else {
      // A supplier may narrow to one of THEIR projects, never widen. The intersection is
      // taken against the credential's own list rather than trusting the parameter — the
      // parameter is a filter, not a claim.
      if (requestedProjectId) {
        const projectId = assertDocUuid(requestedProjectId, 'projectId');
        if (!caller.projectIds.includes(projectId)) {
          // Same shape as an empty project: a supplier must not be able to tell a
          // project they cannot see from one with nothing bound to it.
          return docJson(200, { documents: [] });
        }
        projectIds = [projectId];
      } else {
        projectIds = caller.projectIds;
      }
    }

    if (projectIds.length === 0) return docJson(200, { documents: [] });

    // ── Bindings -> documents -> final versions ──────────────────────────────────────
    const { data: bindings, error: bindErr } = await supabase
      .from('doc_bindings')
      .select('document_id, project_id')
      .in('project_id', projectIds);

    if (bindErr) {
      console.error('[doc-portal] binding list failed:', bindErr);
      throw new Error('Could not load the documents for this project.');
    }

    const documentIds = [...new Set((bindings || []).map((b: { document_id: string }) => b.document_id))];
    if (documentIds.length === 0) return docJson(200, { documents: [] });

    let documentQuery = supabase.from('doc_documents').select(DOCUMENT_COLUMNS).in('id', documentIds);
    // Clause 2 of the rule, applied in the database rather than after the fact, so an
    // internal document never travels as far as this function's memory on a supplier
    // request.
    if (!isInternal(caller)) documentQuery = documentQuery.eq('audience', 'supplier');

    const { data: documents, error: docErr } = await documentQuery.order('title');
    if (docErr) {
      console.error('[doc-portal] document list failed:', docErr);
      throw new Error('Could not load the documents for this project.');
    }

    const docRows = (documents || []) as unknown as DocumentRow[];
    if (docRows.length === 0) return docJson(200, { documents: [] });

    // Clause 1: the FINAL version only. For a supplier this is the only version that
    // exists as far as the response is concerned; for an internal user it is the headline
    // and the full history lives behind /api/doc/documents/:id/versions.
    const { data: finals, error: finalErr } = await supabase
      .from('doc_versions')
      .select(VERSION_COLUMNS)
      .in('document_id', docRows.map(d => d.id))
      .eq('is_final', true);

    if (finalErr) {
      console.error('[doc-portal] final version list failed:', finalErr);
      throw new Error('Could not load the documents for this project.');
    }

    const finalByDocument = new Map<string, VersionRow>();
    for (const v of (finals || []) as unknown as VersionRow[]) finalByDocument.set(v.document_id, v);

    // Which project each document came in through, so the portal can group by project
    // when a supplier is on several.
    const projectsByDocument = new Map<string, string[]>();
    for (const b of (bindings || []) as { document_id: string; project_id: string }[]) {
      const list = projectsByDocument.get(b.document_id) || [];
      if (!list.includes(b.project_id)) list.push(b.project_id);
      projectsByDocument.set(b.document_id, list);
    }

    const payload = docRows
      .map(doc => {
        const final = finalByDocument.get(doc.id) || null;
        // A supplier is told about a document only when there is something to give them.
        // An entry with no downloadable release is, to them, not a document.
        if (!isInternal(caller) && !final) return null;
        return {
          document: isInternal(caller) ? toInternalDocumentDto(doc) : toSupplierDocumentDto(doc),
          finalVersion: final
            ? isInternal(caller)
              ? toInternalVersionDto(final)
              : toSupplierVersionDto(final)
            : null,
          projectIds: projectsByDocument.get(doc.id) || [],
        };
      })
      .filter(Boolean);

    return docJson(200, { documents: payload });
  } catch (e) {
    if (e instanceof AuthError) return docJson(401, { error: e.message });
    return handleDocError(e);
  }
};
