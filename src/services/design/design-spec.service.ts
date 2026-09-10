/**
 * Design Specs — registry reads and writes.
 *
 * The supplier round is NOT here: it is the shared review layer in `src/services/review/`,
 * addressed with `{ type: 'design_spec', projectId, id: versionId, version }`. That is the
 * whole point of migration 162 — a fix to link expiry, note triage or attachments lands on
 * the Instruction Manual and on design specs at once.
 *
 * What IS here is what only a design spec has: versions, the issued-final lock, the SKU
 * links, and the cancel that revokes every live link.
 *
 * WRITES ARE GATED IN THE DATABASE, NOT HERE. Every design_spec* table's write policy is
 * `is_design_editor()` (admin or designer, read from user_roles — never from the JWT, which
 * users can write themselves). The `canEditDesignSpecs` helper below exists so the UI can
 * HIDE controls the caller cannot use; it is not the security boundary and must never be the
 * only check.
 */

import { auth, db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  DesignSpec, DesignSpecStage, DesignSpecState, DesignSpecSummary, DesignSpecVersion,
} from '../../types/design-spec.types';
import type { ReviewSubject } from '../../types/review.types';
import { revokeAllReviewShares } from '../review/review-share.service';

const mapSpecRow = (row: any): DesignSpec => ({
  id: row.id,
  projectId: row.project_id,
  specCode: row.spec_code,
  title: row.title,
  ownerId: row.owner_id ?? null,
  state: (row.state ?? 'backlog') as DesignSpecState,
  finalVersionId: row.final_version_id ?? null,
  issuedAt: row.issued_at ?? null,
  issuedBy: row.issued_by ?? null,
  cancelledAt: row.cancelled_at ?? null,
  cancelledBy: row.cancelled_by ?? null,
  createdAt: row.created_at,
  createdBy: row.created_by ?? null,
  updatedAt: row.updated_at ?? null,
  updatedBy: row.updated_by ?? null,
});

const mapVersionRow = (row: any): DesignSpecVersion => ({
  id: row.id,
  specId: row.spec_id,
  version: Number(row.version),
  stage: (row.stage ?? 'initial') as DesignSpecStage,
  revision: row.revision != null ? Number(row.revision) : 1,
  storagePath: row.storage_path,
  stampedPath: row.stamped_path ?? null,
  pageCount: row.page_count != null ? Number(row.page_count) : null,
  byteSize: row.byte_size != null ? Number(row.byte_size) : null,
  note: row.note ?? null,
  uploadedAt: row.uploaded_at,
  uploadedBy: row.uploaded_by ?? null,
});

/** Who the current write is attributable to. Email where we have it, else the user id. */
const actor = async (): Promise<string | null> => {
  const user = await auth.getUser();
  return user?.email ?? user?.id ?? null;
};

/**
 * The review subject for one version of a spec.
 *
 * A design spec round belongs to a VERSION, unlike the IM's, which belongs to the manual.
 * That is why `subject_id` exists at all (migration 162) and why uploading v3 ends v2's
 * round implicitly — nothing looks up v2's links again.
 */
export const designSpecSubject = (
  spec: Pick<DesignSpec, 'projectId'>,
  version: Pick<DesignSpecVersion, 'id' | 'version'>,
): ReviewSubject => ({
  type: 'design_spec',
  projectId: spec.projectId,
  id: version.id,
  version: version.version,
});

/**
 * Every subject id for a spec, for the operations that act on the WHOLE spec rather than one
 * version — cancelling, which must revoke links on every version, not just the current one.
 */
const allSubjects = (spec: DesignSpec, versions: readonly DesignSpecVersion[]): ReviewSubject[] =>
  versions.map(v => designSpecSubject(spec, v));

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** True when the signed-in user may create, upload, send and issue. UI gating only. */
export const canEditDesignSpecs = async (): Promise<boolean> => {
  if (!isLive) return false;
  try {
    const ok = await db.rpc<boolean>('is_design_editor', {});
    return ok === true;
  } catch (e) {
    // Fail CLOSED: a failed check hides the controls rather than showing buttons whose
    // writes the database will refuse anyway.
    console.error('[canEditDesignSpecs] check failed:', e);
    return false;
  }
};

export const getDesignSpecs = async (): Promise<DesignSpec[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('design_specs', { order: { column: 'created_at', ascending: false } }),
    '[getDesignSpecs]',
  );
  return rows.map(mapSpecRow);
};

export const getDesignSpecByProject = async (projectId: string): Promise<DesignSpec | null> => {
  if (!isLive) return null;
  const rows = await orEmpty(
    db.select<Row>('design_specs', { where: { project_id: projectId }, limit: 1 }),
    '[getDesignSpecByProject]',
  );
  return rows.length > 0 ? mapSpecRow(rows[0]) : null;
};

export const getDesignSpecVersions = async (specId: string): Promise<DesignSpecVersion[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('design_spec_versions', {
      where: { spec_id: specId },
      order: { column: 'version', ascending: false },
    }),
    '[getDesignSpecVersions]',
  );
  return rows.map(mapVersionRow);
};

/** Versions for MANY specs in one query, so a board is two reads and not one per row. */
export const getVersionsBySpec = async (
  specIds: readonly string[],
): Promise<Map<string, DesignSpecVersion[]>> => {
  const out = new Map<string, DesignSpecVersion[]>();
  if (!isLive || specIds.length === 0) return out;
  const rows = await orEmpty(
    db.select<Row>('design_spec_versions', {
      where: { spec_id: { op: 'in', value: [...specIds] } },
      order: { column: 'version', ascending: false },
    }),
    '[getVersionsBySpec]',
  );
  for (const row of rows) {
    const v = mapVersionRow(row);
    const list = out.get(v.specId);
    if (list) list.push(v); else out.set(v.specId, [v]);
  }
  return out;
};

export const getDesignSpecSkuIds = async (specId: string): Promise<string[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('design_spec_skus', { columns: 'sku_id', where: { spec_id: specId } }),
    '[getDesignSpecSkuIds]',
  );
  return rows.map((r: any) => r.sku_id);
};

/** One spec with everything its detail page needs. Null when there is no spec. */
export const getDesignSpecDetail = async (
  projectId: string,
): Promise<DesignSpecSummary | null> => {
  const spec = await getDesignSpecByProject(projectId);
  if (!spec) return null;
  const [versions, skuIds] = await Promise.all([
    getDesignSpecVersions(spec.id),
    getDesignSpecSkuIds(spec.id),
  ]);
  return { ...spec, projectName: null, versions, skuIds };
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Start a spec for a project. One per project — the database enforces it, so a second call
 * fails rather than quietly creating a duplicate the board would show twice.
 *
 * `specCode` is deliberately not a parameter: it comes from a sequence, so two designers
 * creating specs at once cannot land on DS-0007 together.
 */
export const createDesignSpec = async (
  projectId: string,
  title: string,
  ownerId?: string | null,
): Promise<DesignSpec> => {
  const user = await auth.getUser();
  const created = await db.insert<Row>('design_specs', {
    project_id: projectId,
    title: title.trim(),
    // Defaults to whoever created it, which is right far more often than null.
    owner_id: ownerId ?? user?.id ?? null,
    created_by: await actor(),
  });
  return mapSpecRow(created);
};

export const updateDesignSpec = async (
  id: string,
  patch: Partial<Pick<DesignSpec, 'title' | 'ownerId'>>,
): Promise<void> => {
  const values: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: await actor(),
  };
  if (patch.title !== undefined) values.title = patch.title.trim();
  if ('ownerId' in patch) values.owner_id = patch.ownerId ?? null;
  await db.updateWhere('design_specs', values, { where: { id } });
};

/**
 * Record an uploaded PDF as the next version.
 *
 * NEITHER NUMBER IS PASSED. A trigger assigns `version` as max+1 across the spec and
 * `revision` as max+1 within the chosen stage, both inside the insert — so two uploads
 * cannot both decide they are v3, nor both claim Final Release v.02 (the two unique
 * constraints are the backstop if they race). The client's own guess at the revision exists
 * only to print the stamp, which happens before this row exists.
 *
 * The same trigger refuses the insert outright when the spec is issued or cancelled — which
 * is what makes the lock mean something — and when `stage` would walk BACKWARDS through
 * Internal Review -> Initial Release -> Final Release. Both raise sentences the panel shows
 * verbatim.
 *
 * Uploading the first version moves the spec out of Backlog — the only place `state` is
 * written by an upload, and the reason Backlog can be a stored value without going stale.
 */
export const addDesignSpecVersion = async (
  specId: string,
  input: {
    stage: DesignSpecStage;
    storagePath: string;
    stampedPath?: string | null;
    pageCount?: number | null;
    byteSize?: number | null;
    note?: string | null;
  },
): Promise<DesignSpecVersion> => {
  const created = await db.insert<Row>('design_spec_versions', {
    spec_id: specId,
    stage: input.stage,
    storage_path: input.storagePath,
    stamped_path: input.stampedPath ?? null,
    page_count: input.pageCount ?? null,
    byte_size: input.byteSize ?? null,
    note: input.note?.trim() || null,
    uploaded_by: await actor(),
  });

  await db.updateWhere('design_specs', {
    state: 'active',
    updated_at: new Date().toISOString(),
    updated_by: await actor(),
  }, { where: { id: specId, state: 'backlog' } });

  return mapVersionRow(created);
};

/**
 * Issue a version as the final. This is the lock.
 *
 * Two guards live in the database and are worth knowing about rather than duplicating here:
 * the version must be one of THIS spec's own (a composite FK), and it must be a FINAL
 * RELEASE (a trigger). So passing an Internal Review's or an Initial Release's id fails
 * loudly instead of issuing a version the supplier's comments have not been applied to.
 */
export const issueDesignSpecFinal = async (
  specId: string,
  versionId: string,
): Promise<void> => {
  const by = await actor();
  const now = new Date().toISOString();
  await db.updateWhere('design_specs', {
    final_version_id: versionId,
    issued_at: now,
    issued_by: by,
    state: 'active',
    updated_at: now,
    updated_by: by,
  }, { where: { id: specId } });
};

/**
 * Unlock an issued spec so a corrected version can be added — which is how a Final Release
 * v.02 comes about. Deliberately a separate, deliberate act rather than a side effect of
 * uploading: correcting a spec a factory may already be building to is a decision.
 *
 * `issued_at` is cleared in the SAME statement as `final_version_id` because
 * `design_specs_issued_stamp` forbids a spec that claims to be final with nothing to point
 * at — clearing them in two calls would fail on the first.
 */
export const unlockDesignSpec = async (specId: string): Promise<void> => {
  const by = await actor();
  const now = new Date().toISOString();
  await db.updateWhere('design_specs', {
    final_version_id: null,
    issued_at: null,
    issued_by: null,
    updated_at: now,
    updated_by: by,
  }, { where: { id: specId } });
};

/**
 * Cancel a spec, and revoke every live review link on every version.
 *
 * The revoke is the point, not a tidy-up: a cancelled spec whose links still resolve is a
 * spec suppliers can still be reviewing. Links are revoked FIRST, so a failure leaves the
 * spec live-but-unreviewable rather than cancelled-but-still-open — the safer half to be
 * stuck in.
 *
 * The versions and the whole review history are kept, as decided; cancelling is a state, not
 * a delete.
 */
export const cancelDesignSpec = async (specId: string): Promise<{ linksRevoked: number }> => {
  const rows = await orEmpty(
    db.select<Row>('design_specs', { where: { id: specId }, limit: 1 }),
    '[cancelDesignSpec] spec',
  );
  if (rows.length === 0) throw new Error('That design spec no longer exists.');
  const spec = mapSpecRow(rows[0]);
  const versions = await getDesignSpecVersions(specId);

  let linksRevoked = 0;
  for (const subject of allSubjects(spec, versions)) {
    linksRevoked += await revokeAllReviewShares(subject, 'review');
  }

  const by = await actor();
  const now = new Date().toISOString();
  await db.updateWhere('design_specs', {
    state: 'cancelled',
    cancelled_at: now,
    cancelled_by: by,
    updated_at: now,
    updated_by: by,
  }, { where: { id: specId } });

  return { linksRevoked };
};

/** Reopen a cancelled spec. Clears the stamp, because the constraint ties it to the state. */
export const reopenDesignSpec = async (specId: string): Promise<void> => {
  const by = await actor();
  const now = new Date().toISOString();
  const versions = await getDesignSpecVersions(specId);
  await db.updateWhere('design_specs', {
    // Back to where the files say it is: Backlog if nothing was ever uploaded.
    state: versions.length > 0 ? 'active' : 'backlog',
    cancelled_at: null,
    cancelled_by: null,
    updated_at: now,
    updated_by: by,
  }, { where: { id: specId } });
};

/**
 * Replace the set of SKUs this spec covers.
 *
 * `projectId` is written on every row so the database can prove the SKU belongs to the
 * spec's own project (two composite FKs, migration 163). Passing a SKU from another project
 * fails as a foreign-key violation rather than silently linking across projects.
 */
export const setDesignSpecSkus = async (
  specId: string,
  projectId: string,
  skuIds: readonly string[],
): Promise<void> => {
  await db.delete('design_spec_skus', { where: { spec_id: specId } });
  if (skuIds.length === 0) return;
  // One round trip, and one transaction: a partial set would silently under-report which
  // SKUs the spec covers.
  await db.insertMany('design_spec_skus', skuIds.map(skuId => ({
    spec_id: specId,
    sku_id: skuId,
    project_id: projectId,
  })));
};
