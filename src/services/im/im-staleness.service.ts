/**
 * IM staleness service
 *
 * A published manual is a frozen snapshot — editing a shared block, a template
 * section, or template content does NOT update already-published JSON. This
 * service flags which published projects are now out of date so they can be
 * re-published.
 *
 * Detection is content-based, not timestamp-based: we re-resolve a project's
 * current template + sections + shared blocks and compare the hash to the last
 * published `content_hash` (im_publish_snapshots). A mismatch means the output
 * would change today → "needs re-publish". This sidesteps the fact that
 * im_sections has no updated_at, and naturally covers block edits, template
 * edits, and resolver changes.
 *
 * The "why" (drill-down) is best-effort and timestamp-based: among the blocks a
 * manual uses, which were updated after it was last published, and whether the
 * template itself changed. When nothing specific explains the mismatch (e.g. a
 * section content edit — sections carry no timestamp), we fall back to a generic
 * "content edited" reason.
 *
 * Only 'generated' projects are checked: saving a manual as a draft flips its
 * status back to 'draft', so a 'generated' row reflects exactly what was last
 * published (its own pending edits are a separate concern).
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { IMBlock, IMSection, IMTemplate, IMTemplateType } from '../../types';
import { getIMTemplates, getIMTemplateById } from './im-template.service';
import { getIMSections } from './im-section.service';
import { getIMBlocks } from './im-block.service';
import { getGeneratedProjectIMs, getProjectIM } from './project-im.service';
import { getProjectSkus } from '../project/project-sku.service';
import { getProjectRequiredLanguages, resolveContentHash, publishResolvedManuals, PublishResult } from './im-publish.service';

export const stalenessKey = (projectId: string, templateType: IMTemplateType) => `${projectId}::${templateType}`;

export interface StaleReason {
  type: 'block' | 'template' | 'content';
  label: string;
}

export interface StaleManual {
  projectId: string;
  templateType: IMTemplateType;
  reasons: StaleReason[];
}

const blocksByIdMap = (blocks: IMBlock[]): Record<string, IMBlock> => {
  const out: Record<string, IMBlock> = {};
  for (const b of blocks) out[b.id] = b;
  return out;
};

interface SnapshotIndex {
  /** Latest content_hash per `${projectId}::${templateType}::${language}`. */
  hashes: Map<string, string>;
  /** Latest published_at per `${projectId}::${templateType}`. */
  publishedAt: Map<string, string>;
}

const loadSnapshots = async (projectId?: string): Promise<SnapshotIndex> => {
  const hashes = new Map<string, string>();
  const publishedAt = new Map<string, string>();
  let query = supabase
    .from('im_publish_snapshots')
    .select('project_id, template_type, language, content_hash, published_at')
    .order('published_at', { ascending: false });
  if (projectId) query = query.eq('project_id', projectId);
  const { data } = await query;
  for (const s of data ?? []) {
    const k3 = `${s.project_id}::${s.template_type}::${s.language}`;
    if (!hashes.has(k3)) hashes.set(k3, s.content_hash); // first seen = latest (descending)
    const k2 = `${s.project_id}::${s.template_type}`;
    if (!publishedAt.has(k2)) publishedAt.set(k2, s.published_at);
  }
  return { hashes, publishedAt };
};

/** Best-effort attribution of why a manual is stale, from source timestamps. */
const computeReasons = (
  template: IMTemplate,
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  publishedAtIso?: string,
): StaleReason[] => {
  const reasons: StaleReason[] = [];
  const pubMs = publishedAtIso ? Date.parse(publishedAtIso) : 0;

  const blockIds = new Set<string>();
  for (const s of sections) {
    for (const ref of (s.blockRefs ?? [])) {
      if (ref.kind === 'block') blockIds.add((ref as { block_id: string }).block_id);
    }
  }
  for (const id of blockIds) {
    const b = blocksById[id];
    if (b?.updatedAt && Date.parse(b.updatedAt) > pubMs) reasons.push({ type: 'block', label: b.title });
  }
  if (template.updatedAt && Date.parse(template.updatedAt) > pubMs) {
    reasons.push({ type: 'template', label: 'Template settings/structure' });
  }
  // Mismatch with no identifiable source change → section content edit (no timestamp), data, or resolver change.
  if (reasons.length === 0) reasons.push({ type: 'content', label: 'Content edited' });
  return reasons;
};

/** Is this manual's published output different from re-resolving it now? */
const isStale = async (
  template: IMTemplate,
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  projectIM: Parameters<typeof resolveContentHash>[3],
  projectId: string,
  hashes: Map<string, string>,
): Promise<boolean> => {
  const langs = getProjectRequiredLanguages(template, projectIM.placeholderData);
  // Same SKU context publish uses, so re-resolved hashes match the published output.
  const projectSkus = (await getProjectSkus(projectId)).map(s => ({ id: s.id, skuNumber: s.skuNumber }));
  for (const lang of langs) {
    const published = hashes.get(`${projectId}::${projectIM.templateType}::${lang}`);
    const { contentHash } = await resolveContentHash(template, sections, blocksById, projectIM, lang, projectSkus);
    if (!published || published !== contentHash) return true;
  }
  return false;
};

/**
 * Detailed staleness for every published manual, keyed by `${projectId}::${templateType}`.
 * Map membership = stale; the value carries the drill-down reasons.
 */
export const getStaleProjectIMDetails = async (): Promise<Map<string, StaleManual>> => {
  const result = new Map<string, StaleManual>();
  if (!isLive) return result;

  const generated = await getGeneratedProjectIMs();
  if (!generated.length) return result;

  const [templates, blocks, snapshots] = await Promise.all([
    getIMTemplates(),
    getIMBlocks(),
    loadSnapshots(),
  ]);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const blocksById = blocksByIdMap(blocks);

  const sectionsByTemplate = new Map<string, IMSection[]>();
  const neededTemplateIds = [...new Set(generated.map((g) => g.im.templateId))];
  await Promise.all(
    neededTemplateIds.map(async (tid) => sectionsByTemplate.set(tid, await getIMSections(tid))),
  );

  for (const { projectId, im } of generated) {
    const template = templateById.get(im.templateId);
    if (!template) continue;
    const sections = sectionsByTemplate.get(im.templateId) ?? [];
    if (!(await isStale(template, sections, blocksById, im, projectId, snapshots.hashes))) continue;
    const reasons = computeReasons(template, sections, blocksById, snapshots.publishedAt.get(stalenessKey(projectId, im.templateType)));
    result.set(stalenessKey(projectId, im.templateType), { projectId, templateType: im.templateType, reasons });
  }
  return result;
};

/** Single-project drill-down (used by the project detail page). Empty = not stale. */
export const getProjectIMStaleReasons = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<StaleReason[]> => {
  if (!isLive) return [];
  const im = await getProjectIM(projectId, templateType);
  if (!im || im.status !== 'generated') return [];
  const template = await getIMTemplateById(im.templateId);
  if (!template) return [];

  const [sections, blocks, snapshots] = await Promise.all([
    getIMSections(im.templateId),
    getIMBlocks(),
    loadSnapshots(projectId),
  ]);
  const blocksById = blocksByIdMap(blocks);
  if (!(await isStale(template, sections, blocksById, im, projectId, snapshots.hashes))) return [];
  return computeReasons(template, sections, blocksById, snapshots.publishedAt.get(stalenessKey(projectId, templateType)));
};

/**
 * Re-publish a project's manual: re-resolve its current template + sections +
 * blocks and overwrite the published JSON / snapshots. Clears its staleness.
 * Refreshes the structured (digital) artifact only — it does not regenerate the
 * PDF or bump the version (those belong to the interactive generator).
 */
export const republishProjectIM = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<PublishResult> => {
  const im = await getProjectIM(projectId, templateType);
  if (!im) throw new Error('No saved manual to re-publish.');
  const template = await getIMTemplateById(im.templateId);
  if (!template) throw new Error('Template not found.');
  const sections = await getIMSections(im.templateId);
  return publishResolvedManuals(projectId, template, sections, im);
};
