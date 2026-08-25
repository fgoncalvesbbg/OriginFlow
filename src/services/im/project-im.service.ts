/**
 * Project IM service
 * Manages instruction manual generation for specific projects
 */

import { auth, db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectIM, SKUContentValue, IMTemplateType, ProjectBlockAddition, ProjectExtraSection, InlineBlockRef } from '../../types';
import { saveWithRetry } from '../core/save-retry';

const mapProjectIMRow = (data: any): ProjectIM => ({
  id: data.id,
  templateId: data.template_id,
  templateType: (data.template_type ?? 'im') as IMTemplateType,
  placeholderData: data.placeholder_data,
  skuContent: data.sku_content ?? {},
  status: data.status,
  isFinalized: data.is_finalized ?? false,
  finalizedAt: data.finalized_at ?? null,
  finalizedBy: data.finalized_by ?? null,
  printedIsFinalized: data.printed_is_finalized ?? false,
  printedFinalizedAt: data.printed_finalized_at ?? null,
  printedFinalizedBy: data.printed_finalized_by ?? null,
  printedRenderId: data.printed_render_id ?? null,
  updatedAt: data.updated_at,
  updatedBy: data.updated_by ?? null,
  version: data.version ?? 0,
  reviewUrl: data.review_url ?? null,
  reviewMarkupId: data.review_markup_id ?? null,
  reviewRequestedAt: data.review_requested_at ?? null,
  reviewRequestedBy: data.review_requested_by ?? null,
  reviewVersion: data.review_version ?? null,
  reviewStatus: data.review_status ?? null,
  reviewDone: data.review_done ?? null,
  reviewActiveThreads: data.review_active_threads ?? null,
  reviewCheckedAt: data.review_checked_at ?? null,
  boundSkuIds: data.bound_sku_ids ?? [],
  sectionAdditions: data.section_additions ?? {},
  extraSections: data.extra_sections ?? [],
  sectionOverrides: data.section_overrides ?? {},
  sectionSkus: data.section_skus ?? {},
  blockOverrides: data.block_overrides ?? {},
});

/**
 * Get a project's generated instance for a given template type (defaults to 'im').
 * A project holds at most one instance per type.
 */
export const getProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<ProjectIM | null> => {
    if (!isLive) return null;
    // Errors PROPAGATE deliberately: returning null on failure made "failed to load"
    // indistinguishable from "no manual exists", which sent the generator to the
    // template picker — from where a save would overwrite the real draft. Callers that
    // can tolerate a miss must catch explicitly.
    const data = await db.selectMaybeOne<Row>('project_ims', {
      where: { project_id: projectId, template_type: templateType },
    });
    return data ? mapProjectIMRow(data) : null;
};

/**
 * Thrown by saveProjectIM when the row changed since the caller's baseline — i.e. someone
 * else (or another tab) saved in between. Carries who/when so the UI can say so.
 */
export class ProjectIMConflictError extends Error {
  constructor(
    public readonly lastUpdatedAt: string,
    public readonly lastUpdatedBy: string | null,
  ) {
    super(
      `This manual was saved by ${lastUpdatedBy ?? 'someone else'} at ${new Date(lastUpdatedAt).toLocaleString()} ` +
      'after you loaded it. Reload to get their version — your edits are backed up locally on this device.',
    );
    this.name = 'ProjectIMConflictError';
  }
}

/**
 * Save/create a project's instance for a given template type (defaults to 'im').
 */
export const saveProjectIM = async (
  projectId: string,
  templateId: string,
  placeholderData: Record<string, string>,
  status: 'draft' | 'generated',
  skuContent?: Record<string, SKUContentValue>,
  templateType: IMTemplateType = 'im',
  sectionAdditions?: Record<string, ProjectBlockAddition[]>,
  extraSections?: ProjectExtraSection[],
  sectionOverrides?: Record<string, InlineBlockRef[]>,
  // When set (on publish), persists this exact version number. Omitted on draft
  // saves so the stored version is left untouched.
  version?: number,
  // project_skus.id values this IM is bound to. Empty array = all project SKUs.
  boundSkuIds?: string[],
  // Per-chapter SKU scope: sectionId → project_skus.id[]. Empty = applies to all.
  sectionSkus?: Record<string, string[]>,
  // Per-project inline block overrides: sectionId → refIndexOrIdKey → replacement inline block.
  blockOverrides?: Record<string, Record<string, InlineBlockRef>>,
  // Optimistic-concurrency baseline: the updated_at of the row the caller loaded/last
  // saved. When provided and the stored row is newer, the save throws
  // ProjectIMConflictError instead of silently overwriting the other person's work.
  // Omit to skip the check (imports/scripts that intend to replace).
  opts?: { baselineUpdatedAt?: string | null },
): Promise<ProjectIM> => {
    // Bound every network call so a stalled request / stale auth lock can't leave the
    // caller's "Saving…" state latched forever. The deadline's signal is forwarded into
    // the port so a timed-out attempt cancels the in-flight request rather than leaving
    // it holding row locks that the retry would then queue behind.
    const existing = await saveWithRetry(
      (timeoutMs) => withDeadline(
        (signal) => db.selectMaybeOne<{ id: string; updated_at: string; updated_by?: string | null }>('project_ims', {
          columns: 'id, updated_at, updated_by',
          where: { project_id: projectId, template_type: templateType },
          signal,
        }),
        timeoutMs,
        'saveProjectIM lookup',
      ),
      { context: 'saveProjectIM lookup' },
    );

    // Concurrent-edit guard (check-then-write; not fully atomic, but catches the
    // human-scale case of two people/tabs on the same manual with 4s autosave).
    if (existing && opts?.baselineUpdatedAt != null && existing.updated_at !== opts.baselineUpdatedAt) {
      throw new ProjectIMConflictError(existing.updated_at, existing.updated_by ?? null);
    }

    const user = await auth.getUser();
    const updatedBy = user?.email ?? user?.id ?? null;

    const payload: Record<string, unknown> = {
        project_id: projectId,
        template_id: templateId,
        template_type: templateType,
        placeholder_data: placeholderData,
        sku_content: skuContent ?? {},
        section_additions: sectionAdditions ?? {},
        extra_sections: extraSections ?? [],
        section_overrides: sectionOverrides ?? {},
        section_skus: sectionSkus ?? {},
        block_overrides: blockOverrides ?? {},
        status,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy,
    };
    if (version !== undefined) payload.version = version;
    if (boundSkuIds !== undefined) payload.bound_sku_ids = boundSkuIds;

    // Echo back only the cheap columns we can't know client-side (row id on insert,
    // the stored version when a draft save omits it, plus the finalize flags which this
    // write never touches) — never the full jsonb row, which would download the whole
    // payload again after every save. Echoing is_finalized/printed_is_finalized keeps a
    // publish/save of a FINAL (or Printed-FINAL) manual from wrongly clearing the lock
    // in the caller's mapped instance.
    const context = existing ? 'saveProjectIM update' : 'saveProjectIM insert';
    const cols = 'id, version, updated_at, is_finalized, finalized_at, printed_is_finalized, printed_finalized_at, printed_finalized_by, printed_render_id';
    type EchoedColumns = {
      id: string; version: number; updated_at: string; is_finalized: boolean; finalized_at: string | null;
      printed_is_finalized: boolean; printed_finalized_at: string | null; printed_finalized_by: string | null; printed_render_id: string | null;
    };

    const runWrite = (timeoutMs: number) => withDeadline(
        (signal) => existing
          ? db.update<EchoedColumns>('project_ims', payload, { where: { id: existing.id }, columns: cols, signal })
          : db.insert<EchoedColumns>('project_ims', payload, { columns: cols, signal }),
        timeoutMs,
        context,
    );

    const data = await saveWithRetry(runWrite, { context, payloadBytes: JSON.stringify(payload).length });

    // Daily rolling backup (best-effort — never blocks or fails the save). One snapshot
    // per calendar day, overwritten by each save that day, pruned to the 3 newest days.
    void backupProjectIM(projectId, templateType, payload, updatedBy)
      .catch((e) => console.warn('[project-im] daily backup failed (non-fatal):', e));

    return mapProjectIMRow({ ...payload, ...data });
};

/**
 * Merge a small patch into a project IM's placeholder_data WITHOUT touching any
 * other column (status/version/content stay untouched). Used to remember cover
 * preferences (__custom_logo / __custom_cover_image) chosen in the print-export
 * dialog, so they become the defaults from then on. Best-effort: a missing row
 * or a failed write only logs — preferences never break the main flow.
 */
export const updateProjectIMPlaceholders = async (
  projectId: string,
  templateType: IMTemplateType,
  patch: Record<string, string>,
): Promise<void> => {
  if (!isLive || !Object.keys(patch).length) return;
  try {
    const data = await db.selectMaybeOne<Row>('project_ims', {
      columns: 'id, placeholder_data',
      where: { project_id: projectId, template_type: templateType },
    });
    if (!data) return;
    const merged = { ...(data.placeholder_data ?? {}), ...patch };
    await db.updateWhere(
      'project_ims',
      { placeholder_data: merged, updated_at: new Date().toISOString() },
      { where: { id: data.id } },
    );
  } catch (e) {
    console.error('[project-im] updateProjectIMPlaceholders failed:', e);
  }
};

/**
 * Mark a project IM as final (locked) or unlock it, touching ONLY the finalize columns
 * so it never races with the large content save payload. `finalized_at` is stamped when
 * finalizing and cleared on unlock. Returns the updated finalize state so the caller can
 * refresh its `instance` without re-fetching the whole row.
 */
export const setProjectIMFinalized = async (
  projectId: string,
  templateType: IMTemplateType,
  isFinalized: boolean,
): Promise<{ isFinalized: boolean; finalizedAt: string | null; finalizedBy: string | null; updatedAt: string }> => {
  const finalizedAt = isFinalized ? new Date().toISOString() : null;
  // Record WHO signed the manual off — the single most audit-relevant fact about a
  // FINAL compliance artifact. Cleared on unlock.
  const user = isFinalized ? await auth.getUser() : null;
  const finalizedBy = isFinalized ? (user?.email ?? user?.id ?? null) : null;
  const updatedAt = new Date().toISOString();
  await db.updateWhere(
    'project_ims',
    { is_finalized: isFinalized, finalized_at: finalizedAt, finalized_by: finalizedBy, updated_at: updatedAt },
    { where: { project_id: projectId, template_type: templateType } },
  );
  return { isFinalized, finalizedAt, finalizedBy, updatedAt };
};

/**
 * Mark the Printed IM (the project's language subset of the Digital IM, shipped
 * physically with the product) as final/locked, or unlock it — touching only the
 * printed_* columns, same isolation as setProjectIMFinalized above. Finalizing must name
 * the exact im_print_renders row being signed off; the DB guard (migration 129) also
 * requires the Digital IM (`is_finalized`) to already be true, since they share content.
 */
export const setProjectPrintedFinalized = async (
  projectId: string,
  templateType: IMTemplateType,
  isFinalized: boolean,
  renderId?: string | null,
): Promise<{ printedIsFinalized: boolean; printedFinalizedAt: string | null; printedFinalizedBy: string | null; printedRenderId: string | null; updatedAt: string }> => {
  if (isFinalized && !renderId) {
    throw new Error('Select a print render to sign off against before marking the Printed IM final.');
  }
  const printedFinalizedAt = isFinalized ? new Date().toISOString() : null;
  const user = isFinalized ? await auth.getUser() : null;
  const printedFinalizedBy = isFinalized ? (user?.email ?? user?.id ?? null) : null;
  const printedRenderId = isFinalized ? (renderId ?? null) : null;
  const updatedAt = new Date().toISOString();
  await db.updateWhere(
    'project_ims',
    {
      printed_is_finalized: isFinalized,
      printed_finalized_at: printedFinalizedAt,
      printed_finalized_by: printedFinalizedBy,
      printed_render_id: printedRenderId,
      updated_at: updatedAt,
    },
    { where: { project_id: projectId, template_type: templateType } },
  );
  return { printedIsFinalized: isFinalized, printedFinalizedAt, printedFinalizedBy, printedRenderId, updatedAt };
};

// ---------------------------------------------------------------------------
// Daily rolling backups (project_im_backups, migration 105)
//
// The editable row is compact JSONB — images are externalized to Storage before every
// save — so keeping 3 daily snapshots per manual costs kilobytes, not megabytes. The
// snapshot for "today" is upserted on every save (so at day rollover it froze at that
// day's last state), and days beyond the newest 3 are pruned.
// ---------------------------------------------------------------------------

export interface ProjectIMBackup {
  backupDate: string;          // YYYY-MM-DD
  savedBy: string | null;
  updatedAt: string;           // last save that refreshed this day's snapshot
  im: ProjectIM;               // the editable state as of that snapshot
}

const backupProjectIM = async (
  projectId: string,
  templateType: IMTemplateType,
  rowPayload: Record<string, unknown>,
  savedBy: string | null,
): Promise<void> => {
  if (!isLive) return;
  const backupDate = new Date().toISOString().slice(0, 10);
  const where = { project_id: projectId, template_type: templateType, backup_date: backupDate };
  const existing = await db.selectMaybeOne<{ id: string }>('project_im_backups', { columns: 'id', where });
  const record = {
    project_id: projectId,
    template_type: templateType,
    backup_date: backupDate,
    payload: rowPayload,
    saved_by: savedBy,
    updated_at: new Date().toISOString(),
  };
  if (existing) await db.updateWhere('project_im_backups', record, { where: { id: existing.id } });
  else await db.insert('project_im_backups', record);

  // Prune to the 3 newest days (a handful of tiny rows — loop deletes are fine).
  const all = await db.select<{ id: string; backup_date: string }>('project_im_backups', {
    columns: 'id, backup_date',
    where: { project_id: projectId, template_type: templateType },
    order: { column: 'backup_date', ascending: false },
  });
  for (const stale of all.slice(3)) {
    await db.delete('project_im_backups', { where: { id: stale.id } });
  }
};

/** The last ≤3 daily snapshots for a manual, newest first. */
export const getProjectIMBackups = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<ProjectIMBackup[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_im_backups', {
      where: { project_id: projectId, template_type: templateType },
      order: { column: 'backup_date', ascending: false },
    }),
    '[getProjectIMBackups]',
  );
  return rows.slice(0, 3).map((r: any) => ({
    backupDate: r.backup_date,
    savedBy: r.saved_by ?? null,
    updatedAt: r.updated_at,
    im: mapProjectIMRow({ ...r.payload, id: r.id, updated_at: r.updated_at }),
  }));
};

/**
 * Delete a project's instance for a given template type (defaults to 'im').
 * A FINAL manual is refused: sign-off must be explicitly revoked (unlock) before the
 * manual can be deleted. The DB trigger (migration 102) enforces the same rule
 * server-side; this check just produces a friendlier error.
 */
export const deleteProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<void> => {
    const row = await db.selectMaybeOne<{ is_finalized?: boolean; printed_is_finalized?: boolean }>('project_ims', {
      columns: 'is_finalized, printed_is_finalized',
      where: { project_id: projectId, template_type: templateType },
    });
    if (row?.is_finalized) throw new Error('This manual is marked FINAL — unlock it before deleting.');
    if (row?.printed_is_finalized) throw new Error('The Printed IM is marked FINAL — unlock it before deleting.');
    await db.delete('project_ims', { where: { project_id: projectId, template_type: templateType } });
};

/**
 * Full project IM rows for every published ('generated') instance, paired with
 * their project id. Used by the staleness check, which re-resolves each one.
 */
export const getGeneratedProjectIMs = async (): Promise<Array<{ projectId: string; im: ProjectIM }>> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_ims', { where: { status: 'generated' } }),
    'getGeneratedProjectIMs',
  );
  return rows.map((row: any) => ({ projectId: row.project_id, im: mapProjectIMRow(row) }));
};

// ---------------------------------------------------------------------------
// Summary type for the All Manuals dashboard view
// ---------------------------------------------------------------------------

export interface ProjectIMSummary {
  id: string;
  projectId: string;        // projects.id (UUID) — used in URL
  projectCode: string | null; // projects.project_id_code — human-readable project ID shown to users
  projectName: string;
  categoryId: string | null;
  templateId: string;
  templateType: IMTemplateType;
  templateName: string | null;
  status: 'draft' | 'generated';
  /**
   * Marked FINAL (locked). Orthogonal to `status`: a manual can be final while draft or
   * generated. Note the lock is enforced in the editor only — migration 98 added no trigger —
   * so any code path that regenerates published output must check this itself.
   */
  isFinalized: boolean;
  finalizedAt: string | null;
  updatedAt: string;
  /** Publish counter — needed (with the review fields) to derive the In Review status. */
  version: number;
  /** Markup.io review round (see mapProjectIMRow) — drives the derived In Review status. */
  reviewUrl: string | null;
  reviewRequestedAt: string | null;
  reviewVersion: number | null;
  /** Cached review outcome (migration 112) — drives the derived Review Done status. */
  reviewDone: boolean | null;
  reviewStatus: string | null;
  reviewActiveThreads: number | null;
  skus: string[];            // SKU numbers on the project (a project can have several)
}

/**
 * Fetch all project IM records with their project name, category, and template name.
 * Used by the IM Dashboard's "All Manuals" tab.
 */
export const getAllProjectIMs = async (): Promise<ProjectIMSummary[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_ims', {
      // Two server-side joins — see data/PORTING.md for the SQL equivalent.
      columns: `
      id,
      project_id,
      template_id,
      template_type,
      status,
      is_finalized,
      finalized_at,
      updated_at,
      version,
      review_url,
      review_requested_at,
      review_version,
      review_done,
      review_status,
      review_active_threads,
      bound_sku_ids,
      project:projects ( id, name, category_id, project_id_code ),
      template:im_templates ( name )
    `,
      order: { column: 'updated_at', ascending: false },
    }),
    '[getAllProjectIMs]',
  );

  // Project SKUs (a project can have several), in display order, indexed by id and project.
  const skusByProject = new Map<string, string[]>();
  const skuNumberById = new Map<string, string>();
  const skuRows = await orEmpty(
    db.select<Row>('project_skus', {
      columns: 'id, project_id, sku_number, sort_order',
      order: { column: 'sort_order', ascending: true },
    }),
    '[getAllProjectIMs] skus',
  );
  for (const r of skuRows) {
    const num = (r.sku_number ?? '').trim();
    if (!num) continue;
    skuNumberById.set(r.id, num);
    const arr = skusByProject.get(r.project_id) ?? [];
    arr.push(num);
    skusByProject.set(r.project_id, arr);
  }

  return rows.map((row: any) => {
    const projectId = row.project?.id ?? row.project_id;
    // The IM's bound SKUs (numbers); empty/legacy binding falls back to all project SKUs.
    const boundIds: string[] = row.bound_sku_ids ?? [];
    const boundNumbers = boundIds.map((id) => skuNumberById.get(id)).filter(Boolean) as string[];
    const skus = boundNumbers.length ? boundNumbers : (skusByProject.get(projectId) ?? []);
    return {
      id: row.id,
      projectId,
      projectCode: row.project?.project_id_code ?? null,
      projectName: row.project?.name ?? 'Unknown Project',
      categoryId: row.project?.category_id ?? null,
      templateId: row.template_id,
      templateType: (row.template_type ?? 'im') as IMTemplateType,
      templateName: row.template?.name ?? null,
      status: row.status as 'draft' | 'generated',
      isFinalized: row.is_finalized ?? false,
      finalizedAt: row.finalized_at ?? null,
      updatedAt: row.updated_at,
      version: row.version ?? 0,
      reviewUrl: row.review_url ?? null,
      reviewRequestedAt: row.review_requested_at ?? null,
      reviewVersion: row.review_version ?? null,
      reviewDone: row.review_done ?? null,
      reviewStatus: row.review_status ?? null,
      reviewActiveThreads: row.review_active_threads ?? null,
      skus,
    };
  });
};
