/**
 * IM import service
 *
 * Materializes an `OriginFlow IM Import v1` JSON document (produced by the Claude
 * Chat review prompt — see docs/im-import/) into a normal category template:
 * one `im_templates` row + N `im_sections` rows. Once created, the project IM is
 * generated from it through the existing template/overlay/resolve/publish pipeline
 * exactly like any other category — no template-less code path is introduced.
 *
 * Everything here runs through the authenticated `supabase` client (via the
 * template/section services), so existing RLS applies to the writes.
 */

import { IMTemplateType, CalloutVariant, InlineBlockRef, BlockRef, ProjectExtraSection } from '../../types';
import { createIMTemplate, updateIMTemplate, getOrCreateBlankTemplate } from './im-template.service';
import { saveIMSection } from './im-section.service';
import { saveProjectIM } from './project-im.service';
import { sanitizeHtml, generateUUID } from '../../utils';

// ---------------------------------------------------------------------------
// Import document shape (OriginFlow IM Import v1) — see docs/im-import/schema.md
// ---------------------------------------------------------------------------

export type ImImportBlockType = 'paragraph' | 'heading' | 'callout' | 'table' | 'image';

/**
 * Whether content is reusable across the whole product category or dedicated to
 * this specific model. `generic` (default) becomes standard, auto-included
 * template content shared by every project in the category. `model-specific` is
 * flagged as a placeholder (isPlaceholder) so future projects re-author it and it
 * is never silently reused for a different model.
 */
export type ImImportScope = 'generic' | 'model-specific';

export interface ImImportImageNeed {
  description: string;
  purpose?: string;
  annotations?: string[];
  suggestedSource?: string;
}

export interface ImImportBlock {
  type: ImImportBlockType;
  level?: number;                       // heading only (1-3)
  variant?: CalloutVariant;             // callout only
  content?: Record<string, string>;     // lang -> html
  imageNeed?: ImImportImageNeed;        // image only
  scope?: ImImportScope;                // default 'generic'
  note?: string;
}

export interface ImImportSection {
  key: string;
  parentKey?: string | null;
  order: number;
  title: Record<string, string>;
  scope?: ImImportScope;                // default 'generic'; 'model-specific' → placeholder section
  blocks: ImImportBlock[];
}

export interface ImImportDoc {
  importSchemaVersion: number;
  kind: IMTemplateType;
  category: string;
  product: { name: string; sku?: string; supplier?: string };
  languages: string[];
  sourceLanguage: string;
  cover?: { title?: Record<string, string>; imageNeed?: ImImportImageNeed };
  sections: ImImportSection[];
  backPage?: { content?: Record<string, string> };
  excludedStandardized?: string[];
  reviewNotes?: {
    corrections?: string[];
    additionsSuggested?: string[];
    deletions?: string[];
    openQuestions?: string[];
  };
}

const CALLOUT_VARIANTS: CalloutVariant[] = ['warning', 'caution', 'electric', 'flammable', 'info'];
const BLOCK_TYPES: ImImportBlockType[] = ['paragraph', 'heading', 'callout', 'table', 'image'];
const SCOPES: ImImportScope[] = ['generic', 'model-specific'];

// ---------------------------------------------------------------------------
// Validation — hand-rolled type guards (matches the codebase's no-zod pattern)
// ---------------------------------------------------------------------------

export interface ImImportValidation {
  doc?: ImImportDoc;
  errors: string[];
  /** Non-fatal notes surfaced to the user (e.g. counts, unknown languages). */
  warnings: string[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isLangMap = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v as Record<string, unknown>).length > 0 &&
  Object.values(v as Record<string, unknown>).every(isStr);

/**
 * Parse + validate a raw import payload (object or JSON string). Returns the
 * typed doc plus any fatal errors; a non-empty `errors` array means do not import.
 */
export const validateImImport = (raw: unknown): ImImportValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];

  let obj: any = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch (e) { return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`], warnings }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { errors: ['Root must be a JSON object.'], warnings };
  }

  if (obj.importSchemaVersion !== 1) errors.push('importSchemaVersion must be 1.');
  if (obj.kind !== 'im' && obj.kind !== 'warning_leaflet') errors.push('kind must be "im" or "warning_leaflet".');
  if (!isStr(obj.category) || !obj.category.trim()) errors.push('category (string) is required.');
  if (!obj.product || !isStr(obj.product.name) || !obj.product.name.trim()) errors.push('product.name (string) is required.');

  const languages: string[] = Array.isArray(obj.languages) && obj.languages.every(isStr) ? obj.languages : [];
  if (!languages.length) errors.push('languages must be a non-empty string array.');
  if (!isStr(obj.sourceLanguage)) errors.push('sourceLanguage (string) is required.');
  else if (languages.length && !languages.includes(obj.sourceLanguage)) errors.push('sourceLanguage must be one of languages.');
  const langSet = new Set(languages);

  if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
    errors.push('sections must be a non-empty array.');
  } else {
    const keys = new Set<string>();
    obj.sections.forEach((s: any, i: number) => {
      const where = `sections[${i}]`;
      if (!isStr(s?.key) || !s.key.trim()) { errors.push(`${where}.key (string) is required.`); return; }
      if (keys.has(s.key)) errors.push(`${where}.key "${s.key}" is duplicated.`);
      keys.add(s.key);
      if (typeof s.order !== 'number') errors.push(`${where}.order (number) is required.`);
      if (!isLangMap(s.title)) errors.push(`${where}.title must be a { lang: string } map.`);
      if (s.scope !== undefined && !SCOPES.includes(s.scope)) errors.push(`${where}.scope must be one of ${SCOPES.join('|')}.`);
      if (!Array.isArray(s.blocks)) { errors.push(`${where}.blocks must be an array.`); return; }
      s.blocks.forEach((b: any, j: number) => {
        const bw = `${where}.blocks[${j}]`;
        if (!BLOCK_TYPES.includes(b?.type)) { errors.push(`${bw}.type must be one of ${BLOCK_TYPES.join('|')}.`); return; }
        if (b.scope !== undefined && !SCOPES.includes(b.scope)) errors.push(`${bw}.scope must be one of ${SCOPES.join('|')}.`);
        if (b.type === 'callout' && !CALLOUT_VARIANTS.includes(b.variant)) errors.push(`${bw}.variant must be one of ${CALLOUT_VARIANTS.join('|')}.`);
        if (b.type === 'image') {
          if (!b.imageNeed || !isStr(b.imageNeed.description)) errors.push(`${bw}.imageNeed.description is required for image blocks.`);
        } else if (!isLangMap(b.content)) {
          errors.push(`${bw}.content must be a { lang: html } map.`);
        }
        if (b.content && isLangMap(b.content)) {
          for (const k of Object.keys(b.content)) if (!langSet.has(k)) warnings.push(`${bw}.content has undeclared language "${k}".`);
        }
      });
    });
    // parentKey references must resolve, and the parent graph must not cycle
    // (a multi-node cycle would otherwise pass here and then silently drop the
    // trapped sections during import — see importIMTemplate's wave loop).
    const parentOf = new Map<string, string | null>();
    obj.sections.forEach((s: any) => { if (isStr(s?.key)) parentOf.set(s.key, s?.parentKey ?? null); });
    obj.sections.forEach((s: any, i: number) => {
      if (s?.parentKey == null) return;
      if (!keys.has(s.parentKey)) { errors.push(`sections[${i}].parentKey "${s.parentKey}" does not match any section key.`); return; }
      if (s.parentKey === s.key) { errors.push(`sections[${i}].parentKey cannot reference itself.`); return; }
      // Walk the parent chain; a revisited key means a cycle.
      const seen = new Set<string>([s.key]);
      let cur: string | null | undefined = s.parentKey;
      while (cur != null) {
        if (seen.has(cur)) { errors.push(`sections[${i}] is part of a parentKey cycle involving "${cur}".`); break; }
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    });
  }

  if (errors.length) return { errors, warnings };

  const doc = obj as ImImportDoc;
  const imageNeeds = doc.sections.reduce((n, s) => n + s.blocks.filter(b => b.type === 'image').length, 0);
  warnings.push(`${doc.sections.length} section(s), ${imageNeeds} image(s) to source.`);
  return { doc, errors, warnings };
};

// ---------------------------------------------------------------------------
// Mapping: import blocks -> im_sections.block_refs (InlineBlockRef[])
// ---------------------------------------------------------------------------

const clean = (content: Record<string, string> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [lang, html] of Object.entries(content ?? {})) out[lang] = sanitizeHtml(html);
  return out;
};

// A section's block_refs each render as their OWN editor row, so body text must be
// grouped into as few blocks as possible. Two normalizations keep imported prose
// readable even when the source JSON is over-fragmented (a separate block per
// sentence / per sub-heading) or under-structured (bare/inline HTML that would
// otherwise become a raw "legacy_html" row in the editor):
//   1. normalizeParagraphHtml — wrap bare/inline text in <p> so it deserializes as a
//      real paragraph block, not opaque raw HTML.
//   2. coalesceFlowBlocks — merge a consecutive run of flow content (paragraph +
//      heading + table) of the same scope into a single ref. The inline editor renders
//      one ref as a single multi-block editing surface, so a chapter with sub-headings
//      and their paragraphs reads as a few grouped blocks, not a stack of dozens of
//      rows. Callouts (the variant wraps the whole ref) and images (placeholders) are
//      left standalone.

const BLOCK_LEVEL_RE = /<(p|h[1-6]|table|ul|ol|blockquote|div|section|figure)[\s/>]/i;

const normalizeParagraphHtml = (html: string): string => {
  const t = (html ?? '').trim();
  if (!t) return '';
  return BLOCK_LEVEL_RE.test(t) ? t : `<p>${t}</p>`;
};

const cleanParagraph = (content: Record<string, string> | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [lang, html] of Object.entries(content ?? {})) out[lang] = sanitizeHtml(normalizeParagraphHtml(html));
  return out;
};

const scopeOf = (b: ImImportBlock): ImImportScope => b.scope ?? 'generic';
// Flow content the editor deserializes cleanly into stacked blocks within one row.
// Callouts carry a ref-level `variant` box and images are placeholders, so both are
// excluded and stay in their own ref.
const isFlowMergeable = (b: ImImportBlock): boolean =>
  (b.type === 'paragraph' || b.type === 'heading' || b.type === 'table') && !b.variant;

/** Merge a run of same-scope flow blocks (paragraph/heading/table) into one block. */
const coalesceFlowBlocks = (blocks: ImImportBlock[]): ImImportBlock[] => {
  const out: ImImportBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && isFlowMergeable(prev) && isFlowMergeable(b) && scopeOf(prev) === scopeOf(b)) {
      const langs = new Set([...Object.keys(prev.content ?? {}), ...Object.keys(b.content ?? {})]);
      const merged: Record<string, string> = {};
      for (const l of langs) merged[l] = normalizeParagraphHtml(prev.content?.[l] ?? '') + normalizeParagraphHtml(b.content?.[l] ?? '');
      const note = [prev.note, b.note].filter(Boolean).join(' ') || undefined;
      // Mark the merged block 'paragraph' so blockToRef runs paragraph normalization
      // (idempotent — the fragments are already <p>/<h*>/<table>-wrapped above).
      out[out.length - 1] = { ...prev, type: 'paragraph', content: merged, note };
    } else {
      out.push(b);
    }
  }
  return out;
};

/** Build the visible "image needed" instruction shown until the user uploads a real asset. */
const imageNeedContent = (need: ImImportImageNeed, languages: string[]): Record<string, string> => {
  const parts = [`<p><strong>Image needed:</strong> ${need.description}</p>`];
  if (need.annotations?.length) parts.push(`<p><em>Annotations:</em> ${need.annotations.join('; ')}</p>`);
  if (need.suggestedSource) parts.push(`<p><em>Source:</em> ${need.suggestedSource}</p>`);
  const html = sanitizeHtml(parts.join(''));
  // Same instruction across every declared language — the user replaces it with a real image.
  return Object.fromEntries(languages.map(l => [l, html]));
};

interface BlockMapOpts {
  /**
   * When true (category-template import), a `model-specific` block is flagged
   * isPlaceholder so it isn't auto-reused for other models in the category. When
   * false (one-off project import), model-specific content renders normally — the
   * IM belongs to a single project, so there is nothing to protect it from.
   */
  placeholderModelSpecific?: boolean;
}

const blockToRef = (b: ImImportBlock, languages: string[], opts: BlockMapOpts = {}): InlineBlockRef => {
  if (b.type === 'image') {
    // isPlaceholder keeps the "Image needed" instruction OUT of the auto-generated
    // manual (it is an opt-in TODO the PM sees while authoring, never auto-rendered),
    // so an unreplaced placeholder can't leak internal guidance into a published PDF.
    // Always a placeholder, regardless of the model-specific option.
    return {
      kind: 'inline',
      variant: 'info',
      isPlaceholder: true,
      content: imageNeedContent(b.imageNeed!, languages),
      note: [b.imageNeed!.description, b.imageNeed!.purpose, b.imageNeed!.suggestedSource].filter(Boolean).join(' — ') || undefined,
    };
  }
  // Paragraphs get <p>-wrapping normalization; headings/callouts/tables carry their
  // own block markup and pass through sanitize only.
  const ref: InlineBlockRef = { kind: 'inline', content: b.type === 'paragraph' ? cleanParagraph(b.content) : clean(b.content) };
  if (b.type === 'callout' && b.variant) ref.variant = b.variant;
  if (b.scope === 'model-specific' && opts.placeholderModelSpecific) ref.isPlaceholder = true;
  if (b.note) ref.note = b.note;
  return ref;
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImImportResult {
  templateId: string;
  categoryId: string;
  templateType: IMTemplateType;
  sectionCount: number;
  imageNeedCount: number;
  /** Sections + blocks flagged model-specific (imported as placeholders). */
  modelSpecificCount: number;
}

/**
 * Create a category template from a validated import doc.
 *
 * @param doc          validated import document
 * @param categoryId   the categories_l3 id chosen by the user (label match is not trusted)
 * @param templateName display name for the new template
 */
export const importIMTemplate = async (
  doc: ImImportDoc,
  categoryId: string,
  templateName: string,
): Promise<ImImportResult> => {
  const template = await createIMTemplate(categoryId, templateName, doc.kind);

  // Persist the declared languages (createIMTemplate defaults to ['en']) and any
  // product-specific back-page content. Standardized boilerplate is intentionally
  // NOT imported — it comes from template metadata / shared blocks at render time.
  const metadataPatch = doc.backPage?.content?.[doc.sourceLanguage]
    ? { metadata: { ...(template.metadata as any), backPageContent: sanitizeHtml(doc.backPage.content[doc.sourceLanguage]) } as any }
    : {};
  await updateIMTemplate(template.id, { languages: doc.languages, ...metadataPatch });

  // Create sections parent-before-child so parent_id can reference a real row id.
  // parentKey (authoring slug) -> created im_sections id.
  const keyToId = new Map<string, string>();
  const remaining = [...doc.sections];
  let imageNeedCount = 0;
  let modelSpecificCount = 0; // sections or blocks flagged model-specific (placeholders)

  // Process in waves: a section is creatable once its parent is a root (null) or
  // already created. Bounded by section count to defend against a bad cycle.
  let guard = remaining.length + 1;
  while (remaining.length && guard-- > 0) {
    const ready = remaining.filter(s => s.parentKey == null || keyToId.has(s.parentKey));
    if (!ready.length) break; // unresolved parents (shouldn't happen post-validation)
    for (const s of ready) {
      const blocks = coalesceFlowBlocks(s.blocks);
      const blockRefs: BlockRef[] = blocks.map(b => {
        if (b.type === 'image') imageNeedCount++;
        if (b.scope === 'model-specific') modelSpecificCount++;
        return blockToRef(b, doc.languages, { placeholderModelSpecific: true });
      });
      // A dedicated (model-specific) chapter becomes a placeholder section: it
      // renders its compliant default content but is flagged for per-project
      // re-authoring, so it is never silently reused verbatim for another model.
      const sectionIsModelSpecific = s.scope === 'model-specific';
      if (sectionIsModelSpecific) modelSpecificCount++;
      const saved = await saveIMSection({
        templateId: template.id,
        parentId: s.parentKey != null ? keyToId.get(s.parentKey)! : null,
        title: s.title[doc.sourceLanguage] ?? Object.values(s.title)[0] ?? s.key,
        titleI18n: s.title,
        order: s.order,
        isPlaceholder: sectionIsModelSpecific,
        content: {},
        blockRefs,
      });
      keyToId.set(s.key, saved.id);
    }
    for (const s of ready) remaining.splice(remaining.indexOf(s), 1);
  }

  // Defensive: validation rejects cycles/unresolved parents, so this should never
  // trigger. If it does, fail loudly rather than silently dropping sections.
  if (remaining.length) {
    throw new Error(`Import incomplete: ${remaining.length} section(s) had unresolvable parents (${remaining.map(s => s.key).join(', ')}).`);
  }

  return {
    templateId: template.id,
    categoryId,
    templateType: doc.kind,
    sectionCount: keyToId.size,
    imageNeedCount,
    modelSpecificCount,
  };
};

// ---------------------------------------------------------------------------
// Project-based import — content lands in ProjectIM.extraSections (no template)
// ---------------------------------------------------------------------------

/**
 * Convert an import doc's sections into project-only `extraSections`, reusing the
 * exact same block mapping (flow coalescing, callouts, image placeholders) as the
 * template importer. parentKey → generated `proj-…` id, parent before child so a
 * child can reference its parent's id.
 */
export const buildExtraSectionsFromDoc = (
  doc: ImImportDoc,
  opts: BlockMapOpts = {},
): ProjectExtraSection[] => {
  const keyToId = new Map<string, string>();
  const out: ProjectExtraSection[] = [];
  const remaining = [...doc.sections];
  let guard = remaining.length + 1;
  while (remaining.length && guard-- > 0) {
    const ready = remaining.filter(s => s.parentKey == null || keyToId.has(s.parentKey));
    if (!ready.length) break;
    for (const s of ready) {
      const id = `proj-${generateUUID().slice(0, 9)}`;
      keyToId.set(s.key, id);
      const blocks = coalesceFlowBlocks(s.blocks).map(b => blockToRef(b, doc.languages, opts));
      out.push({
        id,
        parentId: s.parentKey != null ? keyToId.get(s.parentKey)! : null,
        title: s.title[doc.sourceLanguage] ?? Object.values(s.title)[0] ?? s.key,
        order: s.order,
        blocks,
      });
    }
    for (const s of ready) remaining.splice(remaining.indexOf(s), 1);
  }
  if (remaining.length) {
    throw new Error(`Import incomplete: ${remaining.length} section(s) had unresolvable parents (${remaining.map(s => s.key).join(', ')}).`);
  }
  return out;
};

export interface ImProjectImportResult {
  projectId: string;
  templateType: IMTemplateType;
  sectionCount: number;
  imageNeedCount: number;
}

/**
 * Import a doc directly into a project as a 100% project-based IM: bind the project
 * to the shared blank template and put all content into `extraSections`. No category
 * template is created. Model-specific content renders normally (not placeholders) —
 * this manual belongs to a single project. Overwrites any existing IM for the
 * (project, templateType) pair (saveProjectIM upserts).
 */
export const importProjectIMFromDoc = async (
  projectId: string,
  doc: ImImportDoc,
  templateType: IMTemplateType = doc.kind,
): Promise<ImProjectImportResult> => {
  const blank = await getOrCreateBlankTemplate(templateType);
  const extraSections = buildExtraSectionsFromDoc(doc, { placeholderModelSpecific: false });
  const imageNeedCount = extraSections.reduce(
    (n, s) => n + s.blocks.filter(b => b.kind === 'inline' && b.isPlaceholder && b.variant === 'info').length, 0,
  );

  const placeholderData: Record<string, string> = {
    __cover_title: doc.cover?.title?.[doc.sourceLanguage] ?? doc.product.name,
    __meta_language: doc.sourceLanguage,
    __required_languages: JSON.stringify(doc.languages),
  };

  await saveProjectIM(
    projectId,
    blank.id,
    placeholderData,
    'draft',
    {},               // skuContent
    templateType,
    {},               // sectionAdditions
    extraSections,
    {},               // sectionOverrides
    undefined,        // version
    [],               // boundSkuIds (all SKUs)
    {},               // sectionSkus
    {},               // blockOverrides
  );

  return { projectId, templateType, sectionCount: extraSections.length, imageNeedCount };
};
