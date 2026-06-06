/**
 * IM block service
 * CRUD for shared reusable content blocks (im_blocks table)
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMBlock } from '../../types';
import { handleError, generateUUID } from '../../utils';

const TAG = '[im-block.service]';

/**
 * Reject if a Supabase call hasn't resolved within ms milliseconds.
 * Accepts PromiseLike (Supabase builders are thenable but not full Promises).
 */
const withTimeout = <T>(thenable: PromiseLike<T>, ms = 12000): Promise<T> =>
  Promise.race([
    Promise.resolve(thenable),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms)
    ),
  ]);

const mapRow = (r: any): IMBlock => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
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
  let query = supabase.from('im_blocks').select('*').order('title');
  if (filters?.approvalStatus) query = query.eq('approval_status', filters.approvalStatus);
  if (filters?.categoryId) query = query.contains('applicable_categories', [filters.categoryId]);

  try {
    const { data, error } = await withTimeout(query);
    if (error) { console.error(TAG, 'getIMBlocks error:', error); return []; }
    return (data || []).map(mapRow);
  } catch (e) {
    console.error(TAG, 'getIMBlocks threw:', e);
    return [];
  }
};

export const getIMBlockById = async (id: string): Promise<IMBlock | null> => {
  if (!isLive) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('im_blocks').select('*').eq('id', id).maybeSingle()
    );
    if (error) { console.error(TAG, 'getIMBlockById error:', error); return null; }
    return data ? mapRow(data) : null;
  } catch (e) {
    console.error(TAG, 'getIMBlockById threw:', e);
    return null;
  }
};

export const getIMBlockBySlug = async (slug: string): Promise<IMBlock | null> => {
  if (!isLive) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('im_blocks').select('*').eq('slug', slug).maybeSingle()
    );
    if (error) { console.error(TAG, 'getIMBlockBySlug error:', error); return null; }
    return data ? mapRow(data) : null;
  } catch (e) {
    console.error(TAG, 'getIMBlockBySlug threw:', e);
    return null;
  }
};

export const saveIMBlock = async (block: Partial<IMBlock>): Promise<IMBlock> => {
  const isNew = !block.id;
  const id = block.id ?? generateUUID();
  console.log(TAG, `saveIMBlock — ${isNew ? 'INSERT' : 'UPDATE'} id=${id} slug=${block.slug}`);

  const payload: Record<string, unknown> = {
    id,
    slug: block.slug,
    title: block.title,
    block_type: block.blockType ?? 'content',
    source_language: block.sourceLanguage ?? 'en',
    content: block.content ?? {},
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
    const { data, error } = await withTimeout(
      supabase.from('im_blocks').upsert(payload).select().single()
    );

    if (error) {
      console.error(TAG, 'saveIMBlock Supabase error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      handleError(error, 'saveIMBlock');
    }

    if (!data) {
      const msg = 'saveIMBlock: upsert returned no data and no error';
      console.error(TAG, msg);
      throw new Error(msg);
    }

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
export const getIMBlockUsage = async (id: string): Promise<IMBlockUsageRef[]> => {
  if (!isLive) return [];
  const { data, error } = await withTimeout(
    supabase.from('im_block_section_usage').select('section_id, template_id').eq('block_id', id)
  );
  if (error) {
    console.error(TAG, 'getIMBlockUsage error:', error);
    throw new Error(`Could not verify whether the block is in use: ${error.message}`);
  }
  const rows = data || [];
  if (rows.length === 0) return [];

  // Resolve template names for a human-readable "remove it from X first" message.
  const templateIds = [...new Set(rows.map((r: any) => r.template_id))];
  const { data: tpls } = await withTimeout(
    supabase.from('im_templates').select('id, name').in('id', templateIds)
  );
  const nameById = new Map<string, string>((tpls || []).map((t: any) => [t.id, t.name]));

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
  try {
    const { data, error } = await withTimeout(
      supabase.from('im_block_section_usage').select('block_id')
    );
    if (error) { console.error(TAG, 'getIMBlockUsageCounts error:', error); return {}; }
    const counts: Record<string, number> = {};
    for (const r of data || []) counts[(r as any).block_id] = (counts[(r as any).block_id] ?? 0) + 1;
    return counts;
  } catch (e) {
    console.error(TAG, 'getIMBlockUsageCounts threw:', e);
    return {};
  }
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
    const { error } = await withTimeout(
      supabase.from('im_blocks').delete().eq('id', id)
    );
    if (error) {
      console.error(TAG, 'deleteIMBlock error:', error);
      handleError(error, 'deleteIMBlock');
    }
  } catch (e) {
    console.error(TAG, 'deleteIMBlock threw:', e);
    throw e;
  }
};
