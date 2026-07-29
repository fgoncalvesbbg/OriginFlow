/**
 * Project IM service
 * Manages instruction manual generation for specific projects
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
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
  updatedAt: data.updated_at,
  version: data.version ?? 0,
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
    try {
      const data = await db.selectMaybeOne<Row>('project_ims', {
        where: { project_id: projectId, template_type: templateType },
      });
      return data ? mapProjectIMRow(data) : null;
    } catch (e) {
      console.error('[project-im] getProjectIM failed:', e);
      return null;
    }
};

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
  // Per-project inline block overrides: sectionId → refIndex → replacement inline block.
  blockOverrides?: Record<string, Record<string, InlineBlockRef>>,
): Promise<ProjectIM> => {
    // Bound every network call so a stalled request / stale auth lock can't leave the
    // caller's "Saving…" state latched forever. The deadline's signal is forwarded into
    // the port so a timed-out attempt cancels the in-flight request rather than leaving
    // it holding row locks that the retry would then queue behind.
    const existing = await saveWithRetry(
      (timeoutMs) => withDeadline(
        (signal) => db.selectMaybeOne<{ id: string }>('project_ims', {
          columns: 'id',
          where: { project_id: projectId, template_type: templateType },
          signal,
        }),
        timeoutMs,
        'saveProjectIM lookup',
      ),
      { context: 'saveProjectIM lookup' },
    );

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
        updated_at: new Date().toISOString()
    };
    if (version !== undefined) payload.version = version;
    if (boundSkuIds !== undefined) payload.bound_sku_ids = boundSkuIds;

    // Echo back only the cheap columns we can't know client-side (row id on insert,
    // the stored version when a draft save omits it, plus the finalize flag which this
    // write never touches) — never the full jsonb row, which would download the whole
    // payload again after every save. Echoing is_finalized keeps a publish/save of a
    // FINAL manual from wrongly clearing the lock in the caller's mapped instance.
    const context = existing ? 'saveProjectIM update' : 'saveProjectIM insert';
    const cols = 'id, version, updated_at, is_finalized, finalized_at';
    type EchoedColumns = { id: string; version: number; updated_at: string; is_finalized: boolean; finalized_at: string | null };

    const runWrite = (timeoutMs: number) => withDeadline(
        (signal) => existing
          ? db.update<EchoedColumns>('project_ims', payload, { where: { id: existing.id }, columns: cols, signal })
          : db.insert<EchoedColumns>('project_ims', payload, { columns: cols, signal }),
        timeoutMs,
        context,
    );

    const data = await saveWithRetry(runWrite, { context, payloadBytes: JSON.stringify(payload).length });
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
): Promise<{ isFinalized: boolean; finalizedAt: string | null; updatedAt: string }> => {
  const finalizedAt = isFinalized ? new Date().toISOString() : null;
  const updatedAt = new Date().toISOString();
  await db.updateWhere(
    'project_ims',
    { is_finalized: isFinalized, finalized_at: finalizedAt, updated_at: updatedAt },
    { where: { project_id: projectId, template_type: templateType } },
  );
  return { isFinalized, finalizedAt, updatedAt };
};

/**
 * Delete a project's instance for a given template type (defaults to 'im').
 */
export const deleteProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<void> => {
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
  updatedAt: string;
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
      updated_at,
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
      updatedAt: row.updated_at,
      skus,
    };
  });
};
