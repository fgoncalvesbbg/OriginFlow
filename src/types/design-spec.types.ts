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

/** A draft goes out for review; the final is the one that gets issued and locks the spec. */
export type DesignSpecVersionKind = 'draft' | 'final';

export interface DesignSpecVersion {
  id: string;
  specId: string;
  /** 1-based, assigned server-side by a trigger so two uploads cannot both claim v3. */
  version: number;
  kind: DesignSpecVersionKind;
  /** The design team's original bytes. Never mutated. */
  storagePath: string;
  /**
   * The `DRAFT vN · FOR REVIEW ONLY` copy served to reviewers. Null on a final, which is
   * served exactly as uploaded.
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
