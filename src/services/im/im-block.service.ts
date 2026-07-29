/**
 * IM block service
 * CRUD for shared reusable content blocks (im_blocks table)
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { IMBlock } from '../../types';
import { generateUUID } from '../../utils';
import { saveWithRetry } from '../core/save-retry';
import { externalizeFormDataImages } from './im-asset.service';

const TAG = '[im-block.service]';
/** Default read bound for this service's queries. */
const READ_TIMEOUT_MS = 12000;

const mapRow = (r: any): IMBlock => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  internalTitle: r.internal_title ?? null,
  blockType: r.block_type,
  sourceLanguage: r.source_language,
  content: r.content ?? {},
  placeholders: r.placeholders ?? [],
  applicableCategories: r.applicable_categories ?? [],
  requiresFeature: r.requires_feature ?? null,
  requiresFeatureAbsent: r.requires_feature_absent ?? null,
  regulationRefs: r.regulation_refs ?? [],
  approvalStatus: r.approval_status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastUpdatedBy: r.last_updated_by ?? null,
});

export const getIMBlocks = async (filters?: {
  categoryId?: string;
  approvalStatus?: string;
}): Promise<IMBlock[]> => {
  if (!isLive) { console.warn(TAG, 'getIMBlocks skipped — isLive=false'); return []; }
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_blocks', {
        // Absent filters stay `undefined` and are dropped by the port, so no branching.
        where: {
          approval_status: filters?.approvalStatus,
          applicable_categories: filters?.categoryId
            ? { op: 'arrayContains', value: [filters.categoryId] }
            : undefined,
        },
        order: { column: 'title' },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getIMBlocks',
    ),
    `${TAG} getIMBlocks`,
  );
  return rows.map(mapRow);
};

export const saveIMBlock = async (block: Partial<IMBlock>): Promise<IMBlock> => {
  const isNew = !block.id;
  const id = block.id ?? generateUUID();
  console.log(TAG, `saveIMBlock — ${isNew ? 'INSERT' : 'UPDATE'} id=${id} slug=${block.slug}`);

  // Pasted images must live in Storage, not inline base64 duplicated per language
  // (that's what bloats rows past the write timeout — see im-asset.service).
  const content = block.content
    ? await externalizeFormDataImages(block.content, new Map(), 'blocks')
    : {};

  const payload: Record<string, unknown> = {
    id,
    slug: block.slug,
    title: block.title,
    internal_title: block.internalTitle ?? null,
    block_type: block.blockType ?? 'content',
    source_language: block.sourceLanguage ?? 'en',
    content,
    placeholders: block.placeholders ?? [],
    applicable_categories: block.applicableCategories ?? [],
    requires_feature: block.requiresFeature ?? null,
    requires_feature_absent: block.requiresFeatureAbsent ?? null,
    regulation_refs: block.regulationRefs ?? [],
    approval_status: block.approvalStatus ?? 'draft',
    updated_at: new Date().toISOString(),
  };
  if (block.lastUpdatedBy !== undefined) payload.last_updated_by = block.lastUpdatedBy;

  console.log(TAG, 'saveIMBlock payload:', payload);

  try {
    const data = await saveWithRetry(
      // Forwarding the deadline's signal is what lets a timed-out attempt release its
      // row lock before the retry goes out.
      (timeoutMs) => withDeadline(
        (signal) => db.upsertReturning<Row>('im_blocks', payload, { signal }),
        timeoutMs,
        'saveIMBlock',
      ),
      { context: 'saveIMBlock', payloadBytes: JSON.stringify(payload).length },
    );

    console.log(TAG, 'saveIMBlock success, returned id:', data.id);
    return mapRow(data);
  } catch (e) {
    console.error(TAG, 'saveIMBlock threw:', e);
    throw e;
  }
};

/** A single template section that references a given block. */
export interface IMBlockUsageRef {
  sectionId: string;
  templateId: string;
  templateName: string;
}

/**
 * Find every IM template section that references a block, via the
 * im_block_section_usage view (migration 48).
 *
 * Throws on query failure rather than returning [] — callers (notably
 * deleteIMBlock) treat an empty result as "safe to delete", so a silent
 * failure here must never be mistaken for "not in use".
 */
const getIMBlockUsage = async (id: string): Promise<IMBlockUsageRef[]> => {
  if (!isLive) return [];
  let rows: Row[];
  try {
    rows = await withDeadline(
      (signal) => db.select<Row>('im_block_section_usage', {
        columns: 'section_id, template_id',
        where: { block_id: id },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getIMBlockUsage',
    );
  } catch (e) {
    console.error(TAG, 'getIMBlockUsage error:', e);
    throw new Error(`Could not verify whether the block is in use: ${(e as Error).message}`);
  }
  if (rows.length === 0) return [];

  // Resolve template names for a human-readable "remove it from X first" message.
  const templateIds = [...new Set(rows.map((r: any) => r.template_id))];
  const tpls = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_templates', { columns: 'id, name', where: { id: templateIds }, signal }),
      READ_TIMEOUT_MS,
      'getIMBlockUsage:templates',
    ),
    `${TAG} getIMBlockUsage:templates`,
  );
  const nameById = new Map<string, string>(tpls.map((t: any) => [t.id, t.name]));

  return rows.map((r: any) => ({
    sectionId: r.section_id,
    templateId: r.template_id,
    templateName: nameById.get(r.template_id) ?? r.template_id,
  }));
};

/**
 * Usage count per block id across all IM templates — one query for the whole
 * library, so the UI can flag/disable deletion of in-use blocks up front.
 */
export const getIMBlockUsageCounts = async (): Promise<Record<string, number>> => {
  if (!isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_block_section_usage', { columns: 'block_id', signal }),
      READ_TIMEOUT_MS,
      'getIMBlockUsageCounts',
    ),
    `${TAG} getIMBlockUsageCounts`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[(r as any).block_id] = (counts[(r as any).block_id] ?? 0) + 1;
  return counts;
};

export class BlockInUseError extends Error {
  code = 'BLOCK_IN_USE' as const;
  usage: IMBlockUsageRef[];
  constructor(usage: IMBlockUsageRef[]) {
    const templateNames = [...new Set(usage.map(u => u.templateName))];
    super(
      `Cannot delete: this block is still used by ${usage.length} section(s) across ` +
      `${templateNames.length} template(s) — ${templateNames.join(', ')}. ` +
      `Remove it from all IM templates first.`
    );
    this.name = 'BlockInUseError';
    this.usage = usage;
  }
}

export const deleteIMBlock = async (id: string): Promise<void> => {
  console.log(TAG, 'deleteIMBlock id:', id);

  // Guard: never delete a block that is still referenced by any IM template
  // section. Deleting an in-use block orphans its block_refs and collapses
  // every IM that resolves it. It can only be deleted once removed everywhere.
  const usage = await getIMBlockUsage(id);
  if (usage.length > 0) {
    console.warn(TAG, `deleteIMBlock blocked — block ${id} in use by ${usage.length} section(s)`);
    throw new BlockInUseError(usage);
  }

  try {
    await withDeadline(
      (signal) => db.delete('im_blocks', { where: { id }, signal }),
      READ_TIMEOUT_MS,
      'deleteIMBlock',
    );
  } catch (e) {
    console.error(TAG, 'deleteIMBlock threw:', e);
    throw e;
  }
};
