/**
 * IM template service
 * Manages instruction manual templates
 */

import { db, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { IMTemplate, IMTemplateType } from '../../types';
import { generateUUID } from '../../utils';
import { normalizeIMTemplateMetadata } from '../../utils/im-template-metadata.utils';

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
