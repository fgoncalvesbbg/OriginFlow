/**
 * IM section service
 * Manages sections within instruction manual templates
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { BlockRef, IMSection } from '../../types';
import { generateUUID } from '../../utils';
import { saveWithRetry } from '../core/save-retry';
import { externalizeFormDataImages } from './im-asset.service';

/**
 * Get all sections for an IM template
 */
export const getIMSections = async (templateId: string): Promise<IMSection[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
      db.select<Row>('im_sections', { where: { template_id: templateId } }),
      'getIMSections',
    );
    return rows.map((s: any) => ({
      id: s.id,
      templateId: s.template_id,
      parentId: s.parent_id,
      title: s.title,
      titleI18n: s.title_i18n ?? {},
      order: s.order,
      isPlaceholder: s.is_placeholder,
      content: s.content,
      conditionFeatureId: s.condition_feature_id ?? null,
      conditionLabel: s.condition_label ?? null,
      isFinal: s.is_final ?? false,
      completedLanguages: s.completed_languages ?? [],
      blockRefs: s.block_refs ?? [],
    }));
};

/**
 * Move any inline base64 images out of a section's per-language content and
 * inline block refs into Storage, returning the rewritten copies. This is the
 * template editor's equivalent of the ProjectIMGenerator's externalize step: a
 * pasted screenshot stored inline gets duplicated into every language (content
 * AND block_refs), which is exactly what pushed section rows to tens of MB and
 * made saves time out. The shared cache uploads each distinct image once.
 */
const externalizeSectionImages = async (
  section: Partial<IMSection>,
): Promise<{ content?: Record<string, string>; blockRefs?: BlockRef[] }> => {
    const cache = new Map<string, string>();
    const content = section.content
      ? await externalizeFormDataImages(section.content, cache, 'blocks')
      : section.content;
    let blockRefs = section.blockRefs;
    if (blockRefs?.some((r) => r.kind === 'inline' && r.content && JSON.stringify(r.content).includes('data:image'))) {
      const out: BlockRef[] = [];
      for (const ref of blockRefs) {
        out.push(ref.kind === 'inline' && ref.content
          ? { ...ref, content: await externalizeFormDataImages(ref.content, cache, 'blocks') }
          : ref);
      }
      blockRefs = out;
    }
    return { content, blockRefs };
};

/**
 * Save/update an IM section. Base64 images are externalized to Storage first,
 * and the write itself runs through the shared size-aware retry pipeline.
 * The returned section is built from what was written (including externalized
 * image URLs) — the row is NOT echoed back from the DB, so a large section
 * isn't downloaded again on every save.
 */
export const saveIMSection = async (section: Partial<IMSection>): Promise<IMSection> => {
    const { content, blockRefs } = await externalizeSectionImages(section);

    const payload: any = {
        title: section.title,
        order: section.order,
        content
    };
    if (section.titleI18n !== undefined) payload.title_i18n = section.titleI18n;

    if (section.id) payload.id = section.id;
    else payload.id = generateUUID();

    if (section.templateId) payload.template_id = section.templateId;
    if (section.parentId) payload.parent_id = section.parentId;
    if (section.isPlaceholder !== undefined) payload.is_placeholder = section.isPlaceholder;
    if ('conditionFeatureId' in section) payload.condition_feature_id = section.conditionFeatureId ?? null;
    if ('conditionLabel' in section) payload.condition_label = section.conditionLabel ?? null;
    if (section.isFinal !== undefined) payload.is_final = section.isFinal;
    if (section.completedLanguages !== undefined) payload.completed_languages = section.completedLanguages;
    if (blockRefs !== undefined) payload.block_refs = blockRefs;

    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    // The deadline's signal is forwarded into the port so a timed-out attempt actually
    // cancels the in-flight request — otherwise a retry queues behind its own still-running
    // first attempt's row lock. `upsert` (not `upsertReturning`) because echoing the row
    // back doubled the transfer.
    const payloadBytes = JSON.stringify(payload).length;
    await saveWithRetry(
      (timeoutMs) => withDeadline(
        (signal) => db.upsert('im_sections', payload, { signal }),
        timeoutMs,
        'saveIMSection',
      ),
      { context: 'saveIMSection', payloadBytes },
    );
    return {
      id: payload.id,
      templateId: section.templateId ?? '',
      parentId: section.parentId ?? null,
      title: section.title ?? '',
      titleI18n: section.titleI18n ?? {},
      order: section.order ?? 0,
      isPlaceholder: section.isPlaceholder ?? false,
      content: content ?? {},
      conditionFeatureId: section.conditionFeatureId ?? null,
      conditionLabel: section.conditionLabel ?? null,
      isFinal: section.isFinal ?? false,
      completedLanguages: section.completedLanguages ?? [],
      blockRefs: blockRefs ?? [],
    };
};

/**
 * Delete an IM section
 */
export const deleteIMSection = async (id: string): Promise<void> => {
    await db.delete('im_sections', { where: { id } });
};
