/**
 * IM publish service
 *
 * Writes the structured, render-agnostic ResolvedManual to the public `im-published`
 * Storage bucket — one JSON file per template language plus a manifest — and records a
 * row per language in im_publish_snapshots. This is the digital-first artifact a separate
 * web/PDF render service consumes by a stable URL; rendering is intentionally NOT done here.
 *
 * See db_migrations/54_create_im_published_bucket.sql.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import {
  IMTemplate,
  IMSection,
  ProjectIM,
  IMBlock,
  ResolvedManual,
  RESOLVED_MANUAL_SCHEMA_VERSION,
} from '../../types';
import { resolveManual } from './im-resolver';
import { getIMBlocks } from './im-block.service';

const BUCKET = 'im-published';
const TAG = '[im-publish.service]';

export interface PublishedLanguage {
  language: string;
  url: string;
  storagePath: string;
  contentHash: string;
  warnings: string[];
}

export interface PublishResult {
  manifestUrl: string;
  manifestPath: string;
  languages: PublishedLanguage[];
}

/**
 * The generator persists manual section-visibility toggles as `secvis_<sectionId>`,
 * per-ref visibility overrides as `refvis_<sectionId>:<index>`, and condition toggles
 * as `cond_<featureId>`, but the resolver reads bare keys (e.g.
 * `conditions[section.id]` for `conditionFeatureId === 'manual'` sections). Expand the
 * prefixed keys into the bare keys the resolver expects, preserving the originals.
 * Exported so the in-app JSON download produces byte-identical output to the published file.
 */
export const normalizeResolverData = (
  placeholderData: Record<string, string>,
): Record<string, string> => {
  const out = { ...placeholderData };
  for (const [k, v] of Object.entries(placeholderData)) {
    if (k.startsWith('secvis_')) out[k.slice('secvis_'.length)] = v;
    else if (k.startsWith('cond_')) out[k.slice('cond_'.length)] = v;
    // Per-ref visibility overrides keyed `<sectionId>:<index>` — see resolver walkSection.
    else if (k.startsWith('refvis_')) out[k.slice('refvis_'.length)] = v;
  }
  return out;
};

/**
 * The languages a project actually produces — a subset of the template's, English
 * always included. Stored per project as `__required_languages`; absent = all
 * template languages. Shared by publish and the staleness check so both agree.
 */
export const getProjectRequiredLanguages = (
  template: IMTemplate,
  placeholderData: Record<string, string>,
): string[] => {
  const templateLangs = template.languages?.length ? template.languages : ['en'];
  try {
    const raw = placeholderData?.['__required_languages'];
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      const filtered = templateLangs.filter((l) => l === 'en' || arr.includes(l));
      if (filtered.length) return filtered;
    }
  } catch { /* fall through to all template languages */ }
  return templateLangs;
};

/**
 * Resolve one language through the exact same pipeline publish uses, returning the
 * resolved manual plus its content hash. The staleness check re-runs this and
 * compares the hash to the last published snapshot to detect upstream changes.
 */
export const resolveContentHash = async (
  template: IMTemplate,
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  projectIM: ProjectIM,
  language: string,
): Promise<{ resolved: ResolvedManual; json: string; contentHash: string }> => {
  const resolverIM: ProjectIM = {
    ...projectIM,
    placeholderData: normalizeResolverData(projectIM.placeholderData),
  };
  const resolved = resolveManual(template, sections, blocksById, resolverIM, language);
  const json = JSON.stringify(resolved);
  const contentHash = await sha256Hex(json);
  return { resolved, json, contentHash };
};

/** SHA-256 hex digest of a string — used as content_hash for change detection between publishes. */
const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Public URL of a project's published manifest (the stable entry point the viewer/render
 * service consumes). Deterministic — does not require a DB round-trip. Returns null off-line.
 */
export const getPublishedManifestUrl = (
  projectId: string,
  templateType: 'im' | 'warning_leaflet' = 'im',
): string | null => {
  if (!isLive) return null;
  const path = `${projectId}/${templateType}/manifest.json`;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};

/** Upsert a JSON string to a deterministic path in the public bucket; return its public URL. */
const uploadJson = async (path: string, json: string): Promise<string> => {
  const { error } = await supabase.storage.from(BUCKET).upload(path, json, {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  });
  if (error) throw new Error(`Publish upload failed (${path}): ${error.message}`);
  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return publicUrl;
};

/**
 * Resolve the manual for every template language and publish each as JSON to the
 * `im-published` bucket, plus a manifest at `{projectId}/{templateType}/manifest.json`.
 * Records one im_publish_snapshots row per language.
 *
 * @param projectId  Owning project id (used in the storage path and snapshot rows).
 * @param template   The IM template (provides languages, metadata, layout map).
 * @param sections   All template sections — the resolver does its own visibility filtering.
 * @param projectIM  The persisted project instance (placeholderData + skuContent + templateType).
 */
export const publishResolvedManuals = async (
  projectId: string,
  template: IMTemplate,
  sections: IMSection[],
  projectIM: ProjectIM,
): Promise<PublishResult> => {
  if (!isLive) {
    console.warn(TAG, 'publishResolvedManuals skipped — isLive=false');
    throw new Error('Publishing requires a live Supabase connection');
  }

  const templateType = projectIM.templateType ?? 'im';
  // Publish only the languages this project requires (English always included).
  const languages = getProjectRequiredLanguages(template, projectIM.placeholderData);

  // Blocks referenced by sections — fetched once, keyed by id for the resolver.
  const blocks = await getIMBlocks();
  const blocksById: Record<string, IMBlock> = {};
  for (const b of blocks) blocksById[b.id] = b;

  const { data: userData } = await supabase.auth.getUser();
  const publishedBy = userData?.user?.email ?? userData?.user?.id ?? null;

  const published: PublishedLanguage[] = [];

  for (const language of languages) {
    const { resolved, json, contentHash } = await resolveContentHash(template, sections, blocksById, projectIM, language);
    const storagePath = `${projectId}/${templateType}/${language}.json`;
    const url = await uploadJson(storagePath, json);

    const { error } = await supabase.from('im_publish_snapshots').insert({
      project_id: projectId,
      language,
      resolved,
      content_hash: contentHash,
      storage_path: storagePath,
      template_type: templateType,
      published_by: publishedBy,
    });
    if (error) console.error(TAG, `snapshot insert failed (${language}):`, error);

    published.push({ language, url, storagePath, contentHash, warnings: resolved.warnings });
  }

  // Manifest — the stable entry point the render service polls for all languages.
  const manifestPath = `${projectId}/${templateType}/manifest.json`;
  const manifest = {
    schemaVersion: RESOLVED_MANUAL_SCHEMA_VERSION,
    projectId,
    templateId: template.id,
    templateType,
    publishedAt: new Date().toISOString(),
    languages: published.map((p) => ({ lang: p.language, url: p.url, contentHash: p.contentHash })),
  };
  const manifestUrl = await uploadJson(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(TAG, `published ${published.length} language(s) → ${manifestUrl}`);
  return { manifestUrl, manifestPath, languages: published };
};
