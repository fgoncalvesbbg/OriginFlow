/**
 * Design Specs — the design team's PDF spec for a project, its versions, and its workflow.
 *
 * One spec per project (`design_specs.project_id` is UNIQUE, migration 163). The editable
 * source stays wherever the design team authors it; OriginFlow records that a version
 * exists, stores an immutable copy of every upload, runs the supplier round on the shared
 * review layer from migration 162, and decides who may download what.
 *
 * See docs/originflow-design-specs-module.md for the decisions behind the shape.
 */

/**
 * The STORED part of the workflow — only the two ends.
 *
 * 'backlog' and 'cancelled' are facts nothing in the data can imply, so they are columns.
 * 'active' is simply "between the two". Everything the user actually sees on a board is
 * derived from this plus the versions and the review links — see `DesignSpecStatus`.
 */
export type DesignSpecState = 'backlog' | 'active' | 'cancelled';

/**
 * The RELEASE STAGE of one uploaded version (migration 171).
 *
 *   internal  ours only — the pass before the supplier has ever seen the spec. A trigger
 *             refuses to publish one in a supplier's portal.
 *   initial   the first version the supplier sees; their comments land against it.
 *   final     applies those comments. Only a Final Release may be issued.
 *
 * Forward-only, and each stage has its own revision counter — see
 * src/pages/design/design-spec-release.ts for the labels and the derivation.
 */
export type DesignSpecStage = 'internal' | 'initial' | 'final';

export interface DesignSpecVersion {
  id: string;
  specId: string;
  /**
   * The spec-wide upload counter: 1-based, never reused, assigned server-side by a trigger
   * so two uploads cannot both claim v3. This is the version's IDENTITY — `review_comments`
   * pins every note and every triage verdict to it — and NOT the number the business reads,
   * which is `stage` + `revision`.
   */
  version: number;
  stage: DesignSpecStage;
  /**
   * Which revision within the stage this is: `Final Release v.02` is revision 2. 1-based and
   * assigned server-side alongside `version`, in the same insert.
   */
  revision: number;
  /** The design team's original bytes. Never mutated. */
  storagePath: string;
  /**
   * The stamped copy served to reviewers — `INITIAL RELEASE v.02 · FOR REVIEW ONLY`, or
   * `INTERNAL REVIEW v.01 · NOT FOR DISTRIBUTION`. Null on a Final Release, which is served
   * exactly as uploaded.
   */
  stampedPath: string | null;
  pageCount: number | null;
  byteSize: number | null;
  /** Free-text note from the uploader ("fixed handle radius per Wei's note"). */
  note: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface DesignSpec {
  id: string;
  projectId: string;
  /** Human-readable identifier, DS-0001, assigned by a sequence. */
  specCode: string;
  title: string;
  /** The designer this spec belongs to. Null once that account is deleted. */
  ownerId: string | null;
  state: DesignSpecState;
  /**
   * The issued final version. Non-null IS the lock — the database refuses further versions
   * while it is set, and it is constrained to be one of this spec's own versions.
   */
  finalVersionId: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** A spec with the things every board row and detail header needs alongside it. */
export interface DesignSpecSummary extends DesignSpec {
  projectName: string | null;
  versions: DesignSpecVersion[];
  /** SKUs of the project this spec governs. Empty means "the whole project". */
  skuIds: string[];
}

export interface DesignSpecSkuLink {
  specId: string;
  skuId: string;
  projectId: string;
}

/**
 * A design spec review round as the SUPPLIER's own portal sees it.
 *
 * The portal is anonymous — it holds a project token or a supplier token plus an access
 * code, never a session — so this is not `ReviewShare` with fields hidden. It is what
 * `get_design_spec_rounds_by_project_token` chose to return (migration 170): enough to say
 * which spec, which version, when it was sent and whether it is still open, and nothing
 * about who else was asked to review the same version.
 */
export interface SupplierDesignSpecRound {
  shareId: string;
  /** The review token. Present on dead rounds too — every resolver re-checks the state below. */
  token: string;
  /** The sender's own note on the round ("Factory A", "packaging"), shown as context. */
  label: string | null;
  sentAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  specId: string;
  specCode: string;
  specTitle: string;
  versionId: string;
  version: number;
  versionStage: DesignSpecStage;
  versionRevision: number;
  versionNote: string | null;
  pageCount: number | null;
  projectId: string;
  projectName: string;
}

/**
 * The issued final, as the supplier's portal sees it.
 *
 * `finalVersionId` is null for a spec that exists but has not been issued — the portal shows
 * that as a placeholder rather than nothing, so the Production phase says where the spec will
 * appear before it appears. A cancelled spec is not returned at all.
 */
export interface SupplierDesignSpecFinal {
  specId: string;
  specCode: string;
  specTitle: string;
  state: DesignSpecState;
  finalVersionId: string | null;
  version: number | null;
  pageCount: number | null;
  byteSize: number | null;
  issuedAt: string | null;
  projectId: string;
  projectName: string;
}

/**
 * True once a round's link no longer resolves: revoked, or past its expiry.
 *
 * SUBMITTING IS NOT CLOSING. The review portal says as much to the reviewer's face —
 * "Review submitted. You can still add notes." — so a submitted round stays openable here
 * too. Treating it as closed would take the document away from the one person who has just
 * been reading it, and would contradict the portal they would land on.
 */
export const isRoundClosed = (r: SupplierDesignSpecRound, now: Date = new Date()): boolean =>
  r.revokedAt != null
  || (r.expiresAt != null && new Date(r.expiresAt) <= now);
