/**
 * IM template service
 * Manages instruction manual templates
 */

import { db, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { BlockRef, IMSection, IMTemplate, IMTemplateType } from '../../types';
import { generateUUID } from '../../utils';
import { normalizeIMTemplateMetadata } from '../../utils/im-template-metadata.utils';
import { getIMSections, saveIMSection } from './im-section.service';
import { mapWithConcurrency } from '../core/save-retry';

const mapTemplate = (t: any): IMTemplate => ({
  id: t.id,
  categoryId: t.category_id,
  templateType: (t.template_type ?? 'im') as IMTemplateType,
  name: t.name,
  languages: t.languages,
  isFinalized: t.is_finalized,
  finalizedAt: t.finalized_at,
  metadata: normalizeIMTemplateMetadata(t.metadata),
  updatedAt: t.updated_at,
  lastUpdatedBy: t.last_updated_by
});

/**
 * Get all IM templates
 */
export const getIMTemplates = async (): Promise<IMTemplate[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(db.select<Row>('im_templates'), 'getIMTemplates');
    return rows.map(mapTemplate);
};

/**
 * Get IM template by ID
 */
export const getIMTemplateById = async (id: string): Promise<IMTemplate | undefined> => {
    if (!id || !isLive) return undefined;
    const row = await orUndefined(
        db.selectMaybeOne<Row>('im_templates', { where: { id } }),
        'getIMTemplateById',
    );
    return row ? mapTemplate(row) : undefined;
};

/**
 * Get IM template by category ID and type (defaults to the normal 'im').
 * A category holds at most one template per type.
 */
export const getIMTemplateByCategoryId = async (
  categoryId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate | undefined> => {
    if (!categoryId || !isLive) return undefined;
    const row = await orUndefined(
        db.selectMaybeOne<Row>('im_templates', {
            where: { category_id: categoryId, template_type: templateType },
        }),
        'getIMTemplateByCategoryId',
    );
    return row ? mapTemplate(row) : undefined;
};

/**
 * Create a new IM template
 */
export const createIMTemplate = async (
  categoryId: string,
  name: string,
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate> => {
    const data = await db.insert<Row>('im_templates', {
        id: generateUUID(),
        category_id: categoryId,
        template_type: templateType,
        name,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString()
    });
    if (!data) throw new Error('createIMTemplate: no data returned');
    return mapTemplate(data);
};

/**
 * Duplicate a template — sections and all — into another category.
 *
 * Sibling categories (fridge vs. freezer) share most of their structure and
 * safety prose; without this, a new category starts from blank or a reviewed
 * import doc and the author rebuilds sections that already exist one category
 * over. The clone gets fresh section ids (parent links remapped) and FRESH
 * block-ref ids (project overrides key on ref ids, and a new template starts
 * with no projects — stale keys must not be inheritable). Shared-block
 * references are kept as-is: the block library is cross-category by design.
 * The clone is never FINAL, whatever the source was.
 *
 * Sections are written parents-first (parent_id FK) in waves; a mid-way failure
 * leaves a partially-cloned template, which the error message says to open and
 * finish or delete — silent partial success is worse than a loud one.
 */
export const duplicateIMTemplate = async (
  sourceTemplateId: string,
  targetCategoryId: string,
  name: string,
): Promise<IMTemplate> => {
  const source = await getIMTemplateById(sourceTemplateId);
  if (!source) throw new Error('Source template not found.');
  const existing = await getIMTemplateByCategoryId(targetCategoryId, source.templateType);
  if (existing) throw new Error('The target category already has a template of this type.');

  const data = await db.insert<Row>('im_templates', {
    id: generateUUID(),
    category_id: targetCategoryId,
    template_type: source.templateType,
    name,
    languages: source.languages?.length ? source.languages : ['en'],
    is_finalized: false,
    metadata: JSON.parse(JSON.stringify(source.metadata ?? {})),
    updated_at: new Date().toISOString(),
  });
  if (!data) throw new Error('duplicateIMTemplate: no data returned');
  const target = mapTemplate(data);

  const sections = await getIMSections(sourceTemplateId);
  const idMap = new Map(sections.map((s) => [s.id, generateUUID()]));

  const insertedOldIds = new Set<string>();
  let remaining = [...sections];
  try {
    while (remaining.length) {
      // A wave = every section whose parent is already inserted (or is a root, or
      // points outside this template). An all-blocked remainder (cyclic/corrupt
      // parent links) is force-flushed as roots rather than looping forever.
      let wave = remaining.filter((s) => !s.parentId || insertedOldIds.has(s.parentId) || !idMap.has(s.parentId));
      if (!wave.length) wave = remaining;
      remaining = remaining.filter((s) => !wave.includes(s));

      await mapWithConcurrency(wave, 4, (s) => saveIMSection({
        ...s,
        id: idMap.get(s.id)!,
        templateId: target.id,
        parentId: s.parentId && idMap.has(s.parentId) ? idMap.get(s.parentId)! : null,
        // Strip ref ids — saveIMSection backfills fresh ones.
        blockRefs: (s.blockRefs ?? []).map(({ id: _oldRefId, ...rest }) => rest as BlockRef),
        isFinal: false,
      } as Partial<IMSection>));
      wave.forEach((s) => insertedOldIds.add(s.id));
    }
  } catch (e) {
    throw new Error(
      `Copying sections failed after ${insertedOldIds.size} of ${sections.length} — the new template exists ` +
      `but is incomplete. Open it to finish by hand, or delete it and try again. (${(e as Error).message})`,
    );
  }
  return target;
};

/** Name of the shared, category-less template that project-based imports bind to. */
export const BLANK_TEMPLATE_NAME = 'Blank Standardized Template';

/**
 * Get (or lazily create) the single shared "blank" template of a given type. It has
 * NO category (category_id IS NULL) and NO sections — project-based IM imports bind
 * to it and put all their content in ProjectIM.extraSections, so no per-project or
 * per-category template is needed. Hidden from the Category Templates grid (which
 * iterates real categories). category_id is nullable and the resolver binds a project
 * IM strictly by template_id, so this is safe.
 */
export const getOrCreateBlankTemplate = async (
  templateType: IMTemplateType = 'im',
): Promise<IMTemplate> => {
    const existing = await orEmpty(
        db.select<Row>('im_templates', {
            // A null scalar in `where` means IS NULL — this is the category-less template.
            where: { category_id: null, template_type: templateType },
            limit: 1,
        }),
        'getOrCreateBlankTemplate:lookup',
    );
    if (existing.length) return mapTemplate(existing[0]);

    const data = await db.insert<Row>('im_templates', {
        id: generateUUID(),
        category_id: null,
        template_type: templateType,
        name: BLANK_TEMPLATE_NAME,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString(),
    });
    if (!data) throw new Error('getOrCreateBlankTemplate: no data returned');
    return mapTemplate(data);
};

/**
 * Update IM template information
 */
export const updateIMTemplate = async (id: string, updates: Partial<IMTemplate>): Promise<void> => {
    const payload: Row = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.metadata !== undefined) payload.metadata = JSON.parse(JSON.stringify(updates.metadata));
    if (updates.languages !== undefined) payload.languages = updates.languages;
    if (updates.lastUpdatedBy !== undefined) payload.last_updated_by = updates.lastUpdatedBy;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.isFinalized !== undefined) payload.is_finalized = updates.isFinalized;
    if (updates.finalizedAt !== undefined) payload.finalized_at = updates.finalizedAt;

    payload.updated_at = new Date().toISOString();

    await db.updateWhere('im_templates', payload, { where: { id } });
};

/**
 * Number of project IM instances generated from a template. These block a plain
 * delete because `project_ims.template_id` has no ON DELETE cascade — see
 * deleteIMTemplate.
 */
export const getProjectIMCountForTemplate = async (templateId: string): Promise<number> => {
    if (!templateId || !isLive) return 0;
    try {
        return await db.count('project_ims', { where: { template_id: templateId } });
    } catch (e) {
        console.error('getProjectIMCountForTemplate failed', e);
        return 0;
    }
};

/**
 * Delete a template and its sections (im_sections cascades via FK). If any project
 * manuals were generated from it, deletion is refused unless `force` is set, in
 * which case those project_ims rows are deleted first (otherwise the FK blocks it).
 * Publish snapshots / print renders / shares key off project_id, not the template,
 * so they are unaffected here (same as deleteProjectIM).
 */
export const deleteIMTemplate = async (
  id: string,
  opts: { force?: boolean } = {},
): Promise<void> => {
    const dependents = await getProjectIMCountForTemplate(id);
    if (dependents > 0 && !opts.force) {
      throw new Error(
        `Template is used by ${dependents} project manual(s); pass force to delete them too.`,
      );
    }
    if (dependents > 0) {
      await db.delete('project_ims', { where: { template_id: id } });
    }
    await db.delete('im_templates', { where: { id } });
};
