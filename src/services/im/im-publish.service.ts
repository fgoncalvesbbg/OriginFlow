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

import { auth, db, storage, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { IM_LANGUAGE_CODES, orderIMLanguages } from '../../config/im-languages';
import {
  IMTemplate,
  IMSection,
  ProjectIM,
  IMBlock,
  CategoryAttribute,
  ResolvedManual,
  RESOLVED_MANUAL_SCHEMA_VERSION,
} from '../../types';
import { resolveManual, findTempHighlightSections } from './im-resolver';
import { getIMBlocks } from './im-block.service';
import { getProjectSkus } from '../project/project-sku.service';
import { getCategoryAttributes } from '../compliance/compliance-requirement.service';
import { getTranslationVerbatims } from '../ai/translation-verbatim.service';
import type { TranslationVerbatim } from '../../types';

/** Fetch all category attributes as an id→attribute map for data-type-aware condition matching. */
export const getAttributesById = async (): Promise<Record<string, CategoryAttribute>> => {
  const attrs = await getCategoryAttributes();
  const byId: Record<string, CategoryAttribute> = {};
  for (const a of attrs) byId[a.id] = a;
  return byId;
};

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
 * The languages a project actually produces, English always included. Stored per
 * project as `__required_languages`; absent = all template languages, in the
 * template's own order. Shared by publish, the print export, and the staleness
 * check so they all agree.
 *
 * WHO OWNS THE LANGUAGE SET
 * -------------------------
 * A project on a CATEGORY template can only NARROW that template's list: the section
 * content it renders exists solely in the languages the template declares, so adding
 * one there would publish English prose under a foreign language label. Add it in the
 * category template (and translate it) first.
 *
 * A project on the shared BLANK template (`categoryId` null — no category, no sections;
 * see getOrCreateBlankTemplate) is the opposite case: every fragment it renders is
 * project-authored (extraSections/overrides/additions), so the PROJECT owns its language
 * set and `__required_languages` is authoritative, not a subset. Without this the blank
 * template's stock `languages: ['en']` clipped every project bound to it to English
 * alone — including the list a project-based import had just declared — and its editor
 * offered no language to add.
 *
 * Display/output ORDER is a separate, optional preference — `__language_order`
 * (e.g. "German, English, French, Italian, then others") — so a project can
 * publish/print in a custom language order without changing which languages are
 * enabled. Only reorders already-enabled languages; any enabled language absent
 * from the stored order is appended at the end in template order ("then others").
 * Absent/invalid → falls back to the template's own order, unchanged from before.
 */
export const getProjectRequiredLanguages = (
  template: IMTemplate,
  placeholderData: Record<string, string>,
): string[] => {
  const templateLangs = template.languages?.length ? template.languages : ['en'];
  // Category-less = the shared blank template: all content is project-authored, so the
  // project may pick any canonical language, not just the ones the template lists.
  const pool = template.categoryId ? templateLangs : IM_LANGUAGE_CODES;

  let enabled = templateLangs;
  try {
    const raw = placeholderData?.['__required_languages'];
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      const filtered = orderIMLanguages(Array.isArray(arr) ? arr : [], pool);
      if (filtered.length) enabled = filtered;
    }
  } catch { /* fall through to all template languages */ }

  try {
    const orderRaw = placeholderData?.['__language_order'];
    if (orderRaw) {
      const seen = new Set<string>();
      const order = (JSON.parse(orderRaw) as string[]).filter((l) => {
        if (!enabled.includes(l) || seen.has(l)) return false;
        seen.add(l);
        return true;
      });
      if (order.length) {
        const rest = enabled.filter((l) => !seen.has(l));
        return [...order, ...rest];
      }
    }
  } catch { /* fall through to template order */ }

  return enabled;
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
  // Project SKUs (id + number) so the resolver can render "Applies to: …" chapter
  // headers and hide chapters scoped to unbound SKUs. Defaults to [].
  projectSkus: Array<{ id: string; skuNumber: string }> = [],
  // Attribute definitions keyed by id, so section conditions resolve with the same
  // data-type-aware logic the generator uses. Must be passed consistently by publish
  // AND staleness so their content hashes match. Defaults to {} (exact-string fallback).
  attributesById: Record<string, CategoryAttribute> = {},
): Promise<{ resolved: ResolvedManual; json: string; contentHash: string }> => {
  const resolverIM: ProjectIM = {
    ...projectIM,
    placeholderData: normalizeResolverData(projectIM.placeholderData),
  };
  const resolved = resolveManual(template, sections, blocksById, resolverIM, language, projectSkus, attributesById);
  const json = JSON.stringify(resolved);
  const contentHash = await sha256Hex(json);
  return { resolved, json, contentHash };
};

// ---------------------------------------------------------------------------
// Verbatim preflight — the XLIFF pipeline freezes legally-mandated wording
// (im-chip-freeze.ts), but a human editing inline HTML afterwards can still
// mangle it, and publish did no content validation at all. This check verifies,
// per publish, that every mandated phrase PRESENT in the English output still
// appears (as its officially approved wording) in every other published
// language. Warn on ordinary manuals; hard-block on FINAL ones — the signed-off
// artifact must not ship with altered mandated wording.
// ---------------------------------------------------------------------------

/** Whitespace-insensitive text normalization (NBSP → space, runs collapsed). */
const normText = (s: string): string => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** All human-readable text of a resolved manual (prose, callouts, steps, legends, titles). */
const manualCorpus = (resolved: ResolvedManual): string => {
  const parts: string[] = [];
  for (const section of resolved.sections) {
    parts.push(section.title);
    for (const node of section.nodes) {
      if (node.type === 'html' || node.type === 'callout') parts.push(node.text);
      else if (node.type === 'step_sequence') for (const st of node.steps) parts.push(st.text);
      else if (node.type === 'legend_table') for (const r of node.rows) parts.push(r.label);
    }
  }
  return normText(parts.join('\n'));
};

export interface VerbatimViolation {
  /** The mandated source (EN) phrase. */
  phrase: string;
  /** Uppercased languages whose output is missing/altering its approved wording. */
  languages: string[];
}

/**
 * For every verbatim phrase present in the ENGLISH output, check that each other
 * language's output contains that language's officially approved wording (or the
 * source phrase itself when no translation is stored — the language-neutral
 * identifier case, mirroring im-chip-freeze's thaw semantics). Whitespace-
 * insensitive, case-SENSITIVE (verbatim means verbatim). Pure — exported for tests.
 */
export const findVerbatimViolations = (
  manuals: Array<{ language: string; resolved: ResolvedManual }>,
  verbatims: TranslationVerbatim[],
): VerbatimViolation[] => {
  const en = manuals.find((m) => m.language.toLowerCase() === 'en');
  if (!en) return [];
  const enCorpus = manualCorpus(en.resolved);
  const others = manuals
    .filter((m) => m.language.toLowerCase() !== 'en')
    .map((m) => ({ lang: m.language, corpus: manualCorpus(m.resolved) }));

  const out: VerbatimViolation[] = [];
  for (const v of verbatims) {
    const phrase = normText(v.phrase ?? '');
    if (!phrase || !enCorpus.includes(phrase)) continue;
    const missing: string[] = [];
    for (const { lang, corpus } of others) {
      const stored = v.translations?.[lang] ?? v.translations?.[lang.toLowerCase()];
      const expected = normText(stored?.trim() ? stored : v.phrase);
      if (expected && !corpus.includes(expected)) missing.push(lang.toUpperCase());
    }
    if (missing.length) out.push({ phrase: v.phrase, languages: missing });
  }
  return out;
};

const shortPhrase = (p: string): string => (p.length > 60 ? `${p.slice(0, 57)}…` : p);

/** SHA-256 hex digest of a string — used as content_hash for change detection between publishes. */
const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// ---------------------------------------------------------------------------
// Publish history — surfaces the im_publish_snapshots rows every publish already
// writes (language, content hash, when, by whom), grouped into publish events.
// This is the read side of the audit trail; without it "what is live, since when,
// published by whom" is unanswerable in-app.
// ---------------------------------------------------------------------------

export interface PublishHistoryEvent {
  publishedAt: string;
  publishedBy: string | null;
  languages: Array<{ language: string; contentHash: string }>;
}

/**
 * The project's publish events, newest first. Snapshot rows are written one per
 * language within a single publish, seconds apart — rows by the same publisher
 * within a 60s window are grouped into one event.
 */
export const getPublishHistory = async (
  projectId: string,
  templateType: 'im' | 'warning_leaflet' = 'im',
  limit = 20,
): Promise<PublishHistoryEvent[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_publish_snapshots', {
      columns: 'language, content_hash, published_at, published_by',
      where: { project_id: projectId, template_type: templateType },
      order: { column: 'published_at', ascending: false },
    }),
    '[getPublishHistory]',
  );
  const events: PublishHistoryEvent[] = [];
  for (const r of rows as any[]) {
    const last = events[events.length - 1];
    const sameEvent = last
      && (last.publishedBy ?? null) === (r.published_by ?? null)
      && Math.abs(new Date(last.publishedAt).getTime() - new Date(r.published_at).getTime()) < 60_000;
    if (sameEvent) {
      last.languages.push({ language: r.language, contentHash: r.content_hash });
    } else {
      if (events.length >= limit) break;
      events.push({
        publishedAt: r.published_at,
        publishedBy: r.published_by ?? null,
        languages: [{ language: r.language, contentHash: r.content_hash }],
      });
    }
  }
  return events;
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
  return storage.publicUrl(BUCKET, path);
};

/** Public URL of one published language's resolved-manual JSON (deterministic path). */
export const getPublishedManualUrl = (
  projectId: string,
  templateType: 'im' | 'warning_leaflet',
  language: string,
): string | null => {
  if (!isLive) return null;
  return storage.publicUrl(BUCKET, `${projectId}/${templateType}/${language}.json`);
};

/** Upsert a JSON string to a deterministic path in the public bucket; return its public URL. */
const uploadJson = async (path: string, json: string): Promise<string> => {
  try {
    await storage.upload(BUCKET, path, json, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });
  } catch (e) {
    throw new Error(`Publish upload failed (${path}): ${(e as Error).message}`);
  }
  return storage.publicUrl(BUCKET, path);
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
  // Optional progress reporter — called once per language as it's resolved+uploaded, so the
  // UI can show "Publishing language 3/12 (de)…" instead of an opaque spinner.
  onProgress?: (done: number, total: number, language: string) => void,
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

  // Project SKUs — used to render per-chapter "Applies to: …" headers and to hide
  // chapters scoped to SKUs the IM isn't bound to (see ProjectIM.sectionSkus).
  const skuRows = await getProjectSkus(projectId);
  const projectSkus = skuRows.map(s => ({ id: s.id, skuNumber: s.skuNumber }));

  // Attribute definitions for data-type-aware section-condition matching (fetched once).
  const attributesById = await getAttributesById();

  const user = await auth.getUser();
  const publishedBy = user?.email ?? user?.id ?? null;

  // Resolve every language up front (rather than interleaved with upload below) so a
  // temporary-highlight check can veto the whole publish before anything is written —
  // this is the one choke point every publish path (this function) goes through, so
  // it also protects the staleness module's republishProjectIM, not just the generator.
  const resolvedByLanguage = await Promise.all(
    languages.map((language) => resolveContentHash(template, sections, blocksById, projectIM, language, projectSkus, attributesById)
      .then((r) => ({ language, ...r }))),
  );

  const marked = resolvedByLanguage.flatMap(({ language, resolved }) =>
    findTempHighlightSections(resolved).map(({ title }) => ({ language, sectionTitle: title })));
  if (marked.length) {
    const byTitle = new Map<string, Set<string>>();
    for (const m of marked) {
      if (!byTitle.has(m.sectionTitle)) byTitle.set(m.sectionTitle, new Set());
      byTitle.get(m.sectionTitle)!.add(m.language.toUpperCase());
    }
    const list = [...byTitle.entries()].map(([title, langs]) => `"${title}" (${[...langs].join(', ')})`).join(', ');
    throw new Error(`text is still marked as temporary in: ${list}. Remove the highlight before publishing.`);
  }

  // Verbatim preflight (see findVerbatimViolations). Warn per language; hard-block
  // for FINAL manuals — those must not republish with mandated wording missing/altered.
  const verbatimWarnings = new Map<string, string[]>();
  let verbatims: TranslationVerbatim[] | null = null;
  try {
    verbatims = await getTranslationVerbatims();
  } catch (e) {
    if (projectIM.isFinalized) {
      throw new Error(
        'the mandated-wording (verbatim) list could not be loaded, so its presence in this FINAL manual ' +
        `cannot be verified. Try again, or check the Admin panel → Verbatims. (${(e as Error).message})`,
      );
    }
    const note = 'The mandated-wording (verbatim) check could not run — the phrase list failed to load.';
    for (const { language } of resolvedByLanguage) verbatimWarnings.set(language, [note]);
  }
  if (verbatims) {
    const violations = findVerbatimViolations(resolvedByLanguage, verbatims);
    if (violations.length && projectIM.isFinalized) {
      const list = violations.map((v) => `"${shortPhrase(v.phrase)}" (${v.languages.join(', ')})`).join('; ');
      throw new Error(
        `mandated verbatim wording is missing or altered in: ${list}. This manual is FINAL — ` +
        'fix the wording (or the verbatim list in the Admin panel) before publishing.',
      );
    }
    for (const v of violations) {
      for (const lang of v.languages) {
        const key = resolvedByLanguage.find((r) => r.language.toUpperCase() === lang)?.language ?? lang.toLowerCase();
        const arr = verbatimWarnings.get(key) ?? [];
        arr.push(`Mandated wording missing or altered: "${shortPhrase(v.phrase)}"`);
        verbatimWarnings.set(key, arr);
      }
    }
  }

  const published: PublishedLanguage[] = [];

  for (let i = 0; i < resolvedByLanguage.length; i++) {
    const { language, resolved, json, contentHash } = resolvedByLanguage[i];
    onProgress?.(i + 1, resolvedByLanguage.length, language);
    const storagePath = `${projectId}/${templateType}/${language}.json`;

    let url: string;
    try {
      url = await uploadJson(storagePath, json);
    } catch (e) {
      // Publish is not atomic (per-language uploads, manifest last). Say exactly where
      // it stopped so the operator isn't left guessing what state the bucket is in.
      const done = published.map((p) => p.language.toUpperCase()).join(', ') || 'none';
      const remaining = resolvedByLanguage.slice(i).map((r) => r.language.toUpperCase()).join(', ');
      throw new Error(
        `Publish stopped at ${language.toUpperCase()} (${i + 1} of ${resolvedByLanguage.length}): ${(e as Error).message}\n` +
        `Uploaded before the failure: ${done}. Not uploaded: ${remaining}.\n` +
        `The manifest still points at the previous publish until every language succeeds — publish again to retry.`,
      );
    }

    // The snapshot row is what staleness detection compares against. A lost row makes
    // this manual report "Needs re-publish" forever, so retry once and, if it still
    // fails, surface it as a warning on the publish result instead of only logging.
    let snapshotWarning: string | null = null;
    const snapshotRow = {
      project_id: projectId,
      language,
      resolved,
      content_hash: contentHash,
      storage_path: storagePath,
      template_type: templateType,
      published_by: publishedBy,
    };
    try {
      await db.insertMany('im_publish_snapshots', [snapshotRow]);
    } catch (firstErr) {
      try {
        await db.insertMany('im_publish_snapshots', [snapshotRow]);
      } catch (e) {
        console.error(TAG, `snapshot insert failed (${language}):`, firstErr, e);
        snapshotWarning =
          'The publish record (snapshot) could not be written — this manual will wrongly show ' +
          '"Needs re-publish" until the next successful publish.';
      }
    }

    published.push({
      language, url, storagePath, contentHash,
      warnings: [
        ...resolved.warnings,
        ...(verbatimWarnings.get(language) ?? []),
        ...(snapshotWarning ? [snapshotWarning] : []),
      ],
    });
  }

  // Manifest — the stable entry point the render service polls for all languages.
  const manifestPath = `${projectId}/${templateType}/manifest.json`;
  const manifest = {
    schemaVersion: RESOLVED_MANUAL_SCHEMA_VERSION,
    projectId,
    templateId: template.id,
    templateType,
    // The manual's publish version (ProjectIM.version), so a downstream consumer of the
    // manifest URL can tell WHICH revision it is holding — the URL itself never changes.
    version: projectIM.version ?? null,
    publishedAt: new Date().toISOString(),
    languages: published.map((p) => ({ lang: p.language, url: p.url, contentHash: p.contentHash })),
  };
  const manifestUrl = await uploadJson(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(TAG, `published ${published.length} language(s) → ${manifestUrl}`);
  return { manifestUrl, manifestPath, languages: published };
};
