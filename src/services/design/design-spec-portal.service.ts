/**
 * What a SUPPLIER's own portal knows about this project's design spec.
 *
 * WHY THIS IS NOT `getDesignSpecReviewLinks` WITH A DIFFERENT FILTER. Everything in
 * design-spec-review.service.ts reads `review_shares` as a signed-in user, through RLS. A
 * portal has no session at all: it holds a project's `supplier_link_token`, or a supplier's
 * `portal_token` plus their access code, and runs as `anon` — for which `review_shares`,
 * `design_specs` and `design_spec_versions` are all unreadable, correctly and deliberately.
 * The four SECURITY DEFINER routines from migration 170 are the entire exception, and each
 * re-derives the supplier from the credential rather than trusting an id from the caller.
 *
 * TWO READS, TWO RULES, ON PURPOSE:
 *
 *   rounds — the review links someone explicitly marked for this supplier. A round is
 *            an identity: whoever holds the token is that reviewer, sees that reviewer's own
 *            earlier notes and writes new ones in their name. So publishing one is a decision
 *            a human makes at send time, never something inferred from a free-text label.
 *   finals — the issued spec. No marking: the project's supplier is the party who has to
 *            build to it. Returned before issue too (`finalVersionId: null`), so the portal
 *            can say where it will appear instead of springing it on them.
 *
 * The PDF itself still comes from netlify/functions/design-spec-file.ts, which re-derives
 * entitlement per request with the service role. Nothing here touches Storage.
 */

import { portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  DesignSpecStage, DesignSpecState,
  SupplierDesignSpecFinal, SupplierDesignSpecRound,
} from '../../types/design-spec.types';
import type { PortalCredentials } from '../documents';

const mapRound = (row: Row): SupplierDesignSpecRound => ({
  shareId: row.share_id,
  token: row.token,
  label: row.label ?? null,
  sentAt: row.sent_at,
  expiresAt: row.expires_at ?? null,
  revokedAt: row.revoked_at ?? null,
  submittedAt: row.submitted_at ?? null,
  submittedBy: row.submitted_by ?? null,
  specId: row.spec_id,
  specCode: row.spec_code,
  specTitle: row.spec_title,
  versionId: row.version_id,
  version: row.version_number,
  versionStage: (row.version_stage ?? 'initial') as DesignSpecStage,
  versionRevision: row.version_revision != null ? Number(row.version_revision) : 1,
  versionNote: row.version_note ?? null,
  pageCount: row.page_count ?? null,
  projectId: row.project_id,
  projectName: row.project_name,
});

const mapFinal = (row: Row): SupplierDesignSpecFinal => ({
  specId: row.spec_id,
  specCode: row.spec_code,
  specTitle: row.spec_title,
  state: (row.state ?? 'active') as DesignSpecState,
  finalVersionId: row.final_version_id ?? null,
  version: row.version_number ?? null,
  pageCount: row.page_count ?? null,
  byteSize: row.byte_size ?? null,
  issuedAt: row.issued_at ?? null,
  projectId: row.project_id,
  projectName: row.project_name,
});

/**
 * Which routine a credential selects.
 *
 * A project token answers for ONE project; a supplier token plus access code answers for
 * every project that supplier is on. Nothing merges the two: a caller holding both would
 * still get one answer, from the credential it passed.
 */
const missingCredential = (c: PortalCredentials): boolean =>
  !c.projectToken && !(c.supplierToken && c.accessCode);

/** Design spec review rounds published to this supplier, newest version first. */
export const getSupplierDesignSpecRounds = async (
  credentials: PortalCredentials,
): Promise<SupplierDesignSpecRound[]> => {
  if (!isLive || missingCredential(credentials)) return [];
  const rows = credentials.projectToken
    ? await orEmpty(
      portalDb.rpc<Row[]>('get_design_spec_rounds_by_project_token', {
        p_project_token: credentials.projectToken,
      }),
      '[getSupplierDesignSpecRounds/project]',
    )
    : await orEmpty(
      portalDb.rpc<Row[]>('get_design_spec_rounds_by_supplier', {
        p_supplier_token: credentials.supplierToken,
        p_code: credentials.accessCode,
      }),
      '[getSupplierDesignSpecRounds/supplier]',
    );
  return (rows || []).map(mapRound);
};

/** The design spec(s) this supplier builds to, issued or not yet. */
export const getSupplierDesignSpecFinals = async (
  credentials: PortalCredentials,
): Promise<SupplierDesignSpecFinal[]> => {
  if (!isLive || missingCredential(credentials)) return [];
  const rows = credentials.projectToken
    ? await orEmpty(
      portalDb.rpc<Row[]>('get_design_spec_finals_by_project_token', {
        p_project_token: credentials.projectToken,
      }),
      '[getSupplierDesignSpecFinals/project]',
    )
    : await orEmpty(
      portalDb.rpc<Row[]>('get_design_spec_finals_by_supplier', {
        p_supplier_token: credentials.supplierToken,
        p_code: credentials.accessCode,
      }),
      '[getSupplierDesignSpecFinals/supplier]',
    );
  return (rows || []).map(mapFinal);
};

/**
 * A five-minute signed URL for an ISSUED FINAL, authorized by the portal credential.
 *
 * Deliberately final-only, and the function enforces that server-side rather than trusting
 * this call: a portal credential is a long-lived URL a supplier keeps in their inbox, so
 * letting it reach an unstamped, unissued version would undo the point of stamping every
 * review copy `INITIAL RELEASE v.02 · FOR REVIEW ONLY`. An unissued version still reaches a
 * supplier one way — the review token for a round they were actually sent. An Internal
 * Review reaches them by no path at all: a trigger refuses to mark one for a portal.
 */
export const fetchSupplierDesignSpecFinalUrl = async (
  versionId: string,
  credentials: PortalCredentials,
): Promise<string> => {
  const res = await fetch('/.netlify/functions/design-spec-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      versionId,
      projectToken: credentials.projectToken,
      supplierToken: credentials.supplierToken,
      accessCode: credentials.accessCode,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body?.error ?? 'Could not open that design spec.');
  }
  const { url } = await res.json();
  if (!url) throw new Error('Could not open that design spec.');
  return url;
};
