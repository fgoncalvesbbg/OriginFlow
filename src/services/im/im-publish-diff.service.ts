/**
 * Publish diff — WHAT changed since the last publish, per section and language.
 *
 * The staleness check (im-staleness.service) answers "is the published output out
 * of date?"; this answers the follow-up the operator actually acts on: "which
 * sections would a re-publish change, and in which languages?". Without it,
 * "Needs re-publish" is a black box and re-publishing is an act of faith.
 *
 * No schema needed: every publish already stores the FULL resolved manual per
 * language in im_publish_snapshots.resolved, so the diff is (latest snapshot)
 * vs (a re-resolve of the current template/sections/blocks) — the exact same
 * re-resolve the staleness hash uses. Fetching the stored manuals is heavy, so
 * this is an on-demand drill-down (a "What changed?" click), never a sweep.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType, ResolvedManual, ResolvedSection } from '../../types';
import { getIMTemplateById } from './im-template.service';
import { getIMSections } from './im-section.service';
import { getIMBlocks } from './im-block.service';
import { getProjectIM } from './project-im.service';
import { getProjectSkus } from '../project/project-sku.service';
import { getProjectRequiredLanguages, resolveContentHash, getAttributesById } from './im-publish.service';

export interface PublishDiffEntry {
  sectionId: string;
  title: string;
  kind: 'changed' | 'added' | 'removed' | 'moved';
  /** Uppercased language codes this difference appears in. */
  languages: string[];
}

export interface PublishDiff {
  /** The manual's current (= last published) version number, if any. */
  version: number | null;
  /** When the newest compared snapshot was published. */
  publishedAt: string | null;
  /** Uppercased codes of every language that was compared. */
  checkedLanguages: string[];
  /** Languages required now but never published — everything in them is new. */
  unpublishedLanguages: string[];
  entries: PublishDiffEntry[];
}

/**
 * Key-order-independent stringify. The stored snapshot comes back from jsonb
 * (which re-orders object keys) while the re-resolve is a fresh JS object, so a
 * plain JSON.stringify would report every section as changed. Also drops
 * undefined-valued keys, matching what JSON.stringify(fresh) would have dropped
 * before the snapshot was stored.
 */
const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
};

/** A section minus its position, so content changes and pure moves are told apart. */
const contentKey = (s: ResolvedSection): string =>
  stableStringify({ ...s, order: 0, parentId: null });

/**
 * Section-level differences between the last-published manual and a fresh
 * re-resolve, for ONE language. Pure — exported for tests.
 */
export const diffResolvedSections = (
  prev: ResolvedManual,
  next: ResolvedManual,
): Array<{ sectionId: string; title: string; kind: PublishDiffEntry['kind'] }> => {
  const out: Array<{ sectionId: string; title: string; kind: PublishDiffEntry['kind'] }> = [];
  const prevById = new Map(prev.sections.map((s) => [s.id, s]));
  const nextIds = new Set(next.sections.map((s) => s.id));

  for (const s of next.sections) {
    const old = prevById.get(s.id);
    if (!old) { out.push({ sectionId: s.id, title: s.title, kind: 'added' }); continue; }
    if (contentKey(old) !== contentKey(s)) {
      out.push({ sectionId: s.id, title: s.title, kind: 'changed' });
    } else if (old.order !== s.order || old.parentId !== s.parentId) {
      out.push({ sectionId: s.id, title: s.title, kind: 'moved' });
    }
  }
  for (const s of prev.sections) {
    if (!nextIds.has(s.id)) out.push({ sectionId: s.id, title: s.title, kind: 'removed' });
  }
  return out;
};

/**
 * "Changed since v4: Safety Instructions (DE, FR), Cleaning (all)" — the drill-down
 * behind a stale badge. Null when there is no saved manual or nothing was ever
 * published (no baseline to diff against). An entry-less result with checked
 * languages means the published output matches a re-resolve (not stale after all).
 */
export const getPublishDiff = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<PublishDiff | null> => {
  if (!isLive) return null;
  const im = await getProjectIM(projectId, templateType);
  if (!im) return null;
  const template = await getIMTemplateById(im.templateId);
  if (!template) return null;

  const [sections, blocks, attributesById, skuRows] = await Promise.all([
    getIMSections(im.templateId),
    getIMBlocks(),
    getAttributesById(),
    getProjectSkus(projectId),
  ]);
  const blocksById = Object.fromEntries(blocks.map((b) => [b.id, b]));
  const projectSkus = skuRows.map((s) => ({ id: s.id, skuNumber: s.skuNumber }));
  const languages = getProjectRequiredLanguages(template, im.placeholderData);

  // key = sectionId|kind → languages it applies to (order of first appearance kept).
  const byEntry = new Map<string, PublishDiffEntry>();
  const checked: string[] = [];
  const unpublished: string[] = [];
  let publishedAt: string | null = null;

  for (const language of languages) {
    // Latest stored snapshot for this language — the full resolved manual, one row.
    const rows = await orEmpty(
      db.select<Row>('im_publish_snapshots', {
        columns: 'resolved, published_at',
        where: { project_id: projectId, template_type: templateType, language },
        order: { column: 'published_at', ascending: false },
        limit: 1,
      }),
      '[getPublishDiff]',
    );
    const snapshot = rows[0];
    if (!snapshot?.resolved) { unpublished.push(language.toUpperCase()); continue; }
    if (!publishedAt || snapshot.published_at > publishedAt) publishedAt = snapshot.published_at;

    const { resolved: current } = await resolveContentHash(
      template, sections, blocksById, im, language, projectSkus, attributesById,
    );
    checked.push(language.toUpperCase());
    for (const d of diffResolvedSections(snapshot.resolved as ResolvedManual, current)) {
      const key = `${d.sectionId}|${d.kind}`;
      const entry = byEntry.get(key);
      if (entry) entry.languages.push(language.toUpperCase());
      else byEntry.set(key, { ...d, languages: [language.toUpperCase()] });
    }
  }

  if (!checked.length && !unpublished.length) return null;
  return {
    version: im.version ?? null,
    publishedAt,
    checkedLanguages: checked,
    unpublishedLanguages: unpublished,
    entries: [...byEntry.values()],
  };
};
