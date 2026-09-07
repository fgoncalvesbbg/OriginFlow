/**
 * IM resolver — assembles template + project data into a structured ResolvedManual.
 *
 * Design invariant: if a section has no block_refs (blockRefs === []), the resolver
 * falls back to section.content[language] and emits a single html node. This makes
 * all existing sections work identically without any data migration.
 */

// ---------------------------------------------------------------------------
// ISO callout wrapper — used by both the preview renderer and the PDF renderer
// ---------------------------------------------------------------------------

// ISO 7010 callout icons (WARNING/DANGER/CAUTION, ELECTRIC HAZARD, RISK OF FIRE, HOT SURFACE,
// INFO) live in ./iso-icons — the single source shared with the print PDF builder and the
// inline block editor. Cast to Record<string, string> because blockType here is a bare string
// (IMBlock['blockType'] includes non-callout values like 'content'/'legacy_html'), not the
// narrower CalloutVariant the shared map is keyed by.
import { ISO_CALLOUT_ICONS } from './iso-icons';
const ISO_ICONS: Record<string, string> = ISO_CALLOUT_ICONS;

/**
 * Wraps HTML content in the standard ISO callout structure for safety/info block types.
 * Plain content blocks (`content`, `legacy_html`) are returned unchanged.
 * Safe to call with empty html — returns empty string.
 *
 * `lang` localizes the header (WARNING/CAUTION/…) to the language the manual is
 * shown in; omitting it falls back to English.
 */
export const wrapBlockCallout = (blockType: string, contentHtml: string, lang?: string): string => {
  const icon = ISO_ICONS[blockType];
  if (!icon || !contentHtml) return contentHtml;
  const title = getCalloutTitle(blockType, lang);
  return `<div class="im-block-wrapper im-block-${blockType}"><div class="im-block-icon">${icon}</div><div class="im-block-content"><strong class="im-block-title">${title}</strong>${contentHtml}</div></div>`;
};

// ---------------------------------------------------------------------------
// Temporary-highlight marker — author-visible "not yet final" text (toggled from
// SimpleRichTextEditor's Highlight button, InlineBlockEditor.tsx). The class name
// is the single source of truth: the editor wraps marked text in it, and publish
// scans resolved HTML for it so a manual can never go out with unfinished text.
// ---------------------------------------------------------------------------

export const TEMP_HIGHLIGHT_CLASS = 'im-temp-highlight';

/** Whether a chunk of resolved HTML still carries a temporary-highlight marker. */
export const containsTempHighlight = (html: string): boolean =>
  html.includes(`class="${TEMP_HIGHLIGHT_CLASS}"`);

/** Sections in an already-resolved manual whose HTML still carries the marker. */
export const findTempHighlightSections = (resolved: ResolvedManual): Array<{ id: string; title: string }> =>
  resolved.sections
    .filter((s) => s.nodes.some((n) => 'html' in n && containsTempHighlight(n.html)))
    .map((s) => ({ id: s.id, title: s.title }));

import { getCalloutTitle } from './callout-titles.i18n';
import { buildSkuQrSvg } from './im-qr-code';
import { QR_SKU_PLACEHOLDER_ID } from '../../config/im.constants';
import {
  IMTemplate,
  IMSection,
  IMBlock,
  ProjectIM,
  BlockRef,
  InlineBlockRef,
  ProjectBlockAddition,
  SharedBlockRef,
  SKUSlotRef,
  SKUContentValue,
  AnnotatedImageSetContent,
  LegendTableContent,
  StepSequenceContent,
  ResolvedManual,
  ResolvedSection,
  ResolvedNode,
  ResolvedHtmlNode,
  ResolvedCalloutNode,
  ResolvedAnnotatedImageSetNode,
  ResolvedLegendTableNode,
  ResolvedStepSequenceNode,
  IMMasterLayoutName,
  CategoryAttribute,
  RESOLVED_MANUAL_SCHEMA_VERSION,
} from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nodeCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++nodeCounter}`;

/** Strip HTML tags to produce plain text for the search index. */
const stripHtml = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Substitute {{ tokenName }} placeholders with values from a data map. */
const substituteTokens = (html: string, data: Record<string, string>): string =>
  html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => data[key.trim()] ?? `{{${key.trim()}}}`);

/**
 * Resolve legacy inline chip elements that the current editor encodes:
 *   <span class="im-placeholder" data-id="..." data-label="...">...</span>  → value from placeholderData
 *   <span class="im-condition" data-feature-id="..." data-condition-value="..." data-content="...">...</span>
 *     → included only when conditions[featureId] matches; content decoded from data-content attribute
 */
const resolveLegacyChips = (
  html: string,
  placeholderData: Record<string, string>,
  conditions: Record<string, boolean | string>,
): string => {
  // Placeholder chips → resolved value or label fallback.
  // Image placeholders (data-type="image") render the bound image as an <img>;
  // an unfilled image placeholder renders nothing in the final manual.
  let out = html.replace(
    /<span[^>]*class="[^"]*im-placeholder[^"]*"[^>]*>.*?<\/span>/gs,
    (match) => {
      const id = match.match(/data-id="([^"]*)"/)?.[1] ?? '';
      const attrId = match.match(/data-attr-id="([^"]*)"/)?.[1] ?? '';
      const rawLabel = match.match(/data-label="([^"]*)"/)?.[1] ?? '';
      const type = match.match(/data-type="([^"]*)"/)?.[1] ?? 'text';
      const label = rawLabel ? decodeURIComponent(rawLabel) : '';
      // Resolve by data-id first; fall back to the attribute binding (data-attr-id).
      // The binding is stable across languages, so a placeholder whose data-id was
      // regenerated (e.g. per-language authoring or AI translation) still resolves.
      const value =
        (id && placeholderData[id] !== undefined) ? placeholderData[id]
        : (attrId && placeholderData[attrId] !== undefined) ? placeholderData[attrId]
        : undefined;
      if (type === 'image') {
        if (!value) return '';
        return `<img src="${value}" alt="${label}" class="im-product-image" style="max-width:100%;height:auto;" />`;
      }
      return value ?? label;
    },
  );

  // Condition chips → include decoded content when condition is met, else empty string
  out = out.replace(
    /<span[^>]*class="[^"]*im-condition[^"]*"[^>]*data-feature-id="([^"]*)"[^>]*data-condition-value="([^"]*)"[^>]*data-content="([^"]*)"[^>]*>.*?<\/span>/gs,
    (_, featureId, conditionValue, encodedContent) => {
      const actual = conditions[featureId];
      if (actual === undefined) return '';
      const matches =
        conditionValue === '' ||
        conditionValue === 'any' ||
        String(actual) === conditionValue ||
        actual === true;
      return matches ? decodeURIComponent(encodedContent) : '';
    },
  );

  return out;
};

const calloutVariant = (
  blockType: IMBlock['blockType'],
): ResolvedCalloutNode['variant'] | null => {
  const map: Record<string, ResolvedCalloutNode['variant']> = {
    warning: 'warning',
    danger: 'danger',
    caution: 'caution',
    electric: 'electric',
    flammable: 'flammable',
    hot_surface: 'hot_surface',
    info: 'info',
  };
  return map[blockType] ?? null;
};

const resolveSectionLayout = (
  section: IMSection,
  sectionLayoutMap?: Record<string, IMMasterLayoutName>,
): IMMasterLayoutName => {
  if (!sectionLayoutMap) return 'body';
  return (
    sectionLayoutMap[section.id] ||
    sectionLayoutMap[section.parentId ? 'type:subsection' : 'type:section'] ||
    sectionLayoutMap[section.isPlaceholder ? 'type:placeholder' : 'type:content'] ||
    sectionLayoutMap['default'] ||
    'body'
  );
};

// ---------------------------------------------------------------------------
// Section-level visibility check
// ---------------------------------------------------------------------------

const isSectionVisible = (
  section: IMSection,
  placeholderData: Record<string, string>,
  conditions: Record<string, boolean | string>,
  attributesById: Record<string, CategoryAttribute> = {},
): boolean => {
  // Manual per-project override (persisted as secvis_<id>, normalized to the bare
  // section-id key) wins for ANY section — this is how a PM hides a standardized
  // section that doesn't apply, or force-includes an attribute-conditioned one.
  const manual = conditions[section.id];
  if (manual === false) return false;
  if (manual === true) return true;
  if (!section.conditionFeatureId) return true;
  if (section.conditionFeatureId === 'manual') {
    return conditions[section.id] !== false;
  }
  const actual = placeholderData[section.conditionFeatureId] ?? conditions[section.conditionFeatureId];
  if (actual === undefined) return false;
  if (!section.conditionLabel || section.conditionLabel === 'any') return true;
  // Data-type-aware match (enum multi-value, boolean Yes/No, numeric range) so the published
  // output agrees with the generator preview/PDF. Falls back to exact-string equality when the
  // attribute definition isn't supplied (e.g. template preview with no project context).
  const attr = attributesById[section.conditionFeatureId];
  if (attr) return matchesConditionValue(String(actual), section.conditionLabel, attr);
  return String(actual) === section.conditionLabel;
};

// ---------------------------------------------------------------------------
// Block-ref resolvers
// ---------------------------------------------------------------------------

// passesFeatureGate / isFalsy now live in src/utils/attribute-condition.utils.ts so the
// compliance module can reuse the same attribute-condition logic. Re-exported here to
// keep existing IM imports (and tests) working unchanged.
import { passesFeatureGate, matchesConditionValue } from '../../utils/attribute-condition.utils';
export { passesFeatureGate };

const resolveInlineRef = (
  ref: InlineBlockRef,
  language: string,
  placeholderData: Record<string, string>,
  conditions: Record<string, boolean | string>,
  warnings: string[],
  override?: boolean,
): ResolvedHtmlNode | ResolvedCalloutNode | null => {
  // A manual project override (Include/Exclude) wins over the automatic gate;
  // otherwise the conditional inline row is hidden when its condition isn't met.
  if (override === false) return null;
  // A placeholder row is opt-in: excluded unless the PM explicitly included it.
  if (ref.isPlaceholder && override !== true) return null;
  if (override !== true && !passesFeatureGate(ref, placeholderData, conditions)) return null;

  let html = ref.content[language] ?? ref.content['en'] ?? '';
  if (!ref.content[language] && ref.content['en']) {
    warnings.push(`inline ref missing '${language}' translation; fell back to 'en'`);
  }
  html = substituteTokens(resolveLegacyChips(html, placeholderData, conditions), placeholderData);
  const id = nextId('n');
  // A variant wraps the whole row in its ISO callout box (renderers call
  // wrapBlockCallout on the variant), matching how shared blocks are wrapped.
  if (ref.variant) {
    return { type: 'callout', id, variant: ref.variant, html, text: stripHtml(html) };
  }
  return { type: 'html', id, html, text: stripHtml(html) };
};

const resolveSharedBlockRef = (
  ref: SharedBlockRef,
  blocksById: Record<string, IMBlock>,
  language: string,
  placeholderData: Record<string, string>,
  conditions: Record<string, boolean | string>,
  warnings: string[],
  override?: boolean,
): ResolvedNode | null => {
  const block = blocksById[ref.block_id];
  if (!block) {
    warnings.push(`block ${ref.block_id} not found`);
    return null;
  }

  // Manual project override (Include/Exclude) wins over the automatic feature gate.
  if (override === false) return null;
  if (override !== true && !passesFeatureGate(ref, placeholderData, conditions)) return null;

  let html = block.content[language] ?? block.content['en'] ?? '';
  if (!block.content[language] && block.content['en']) {
    warnings.push(`block '${block.slug}' missing '${language}' translation`);
  }
  html = substituteTokens(resolveLegacyChips(html, placeholderData, conditions), placeholderData);

  const id = nextId('n');
  const variant = calloutVariant(block.blockType);
  if (variant) {
    return { type: 'callout', id, variant, html, text: stripHtml(html), sourceBlock: block.slug };
  }
  return { type: 'html', id, html, text: stripHtml(html), sourceBlock: block.slug };
};

const resolveSkuSlotRef = (
  ref: SKUSlotRef,
  skuContent: Record<string, SKUContentValue> | undefined,
  language: string,
  warnings: string[],
): ResolvedNode | null => {
  const value = skuContent?.[ref.slot];
  if (!value) {
    if (ref.required) warnings.push(`required sku_slot '${ref.slot}' has no content`);
    return null;
  }

  const id = nextId('n');

  if (value.type === 'annotated_image_set') {
    return {
      type: 'annotated_image_set',
      id,
      images: (value as AnnotatedImageSetContent).images,
    } as ResolvedAnnotatedImageSetNode;
  }

  if (value.type === 'legend_table') {
    const rows = (value as LegendTableContent).rows.map(r => ({
      number: r.number,
      label: r.label[language] ?? r.label['en'] ?? '',
    }));
    return { type: 'legend_table', id, rows } as ResolvedLegendTableNode;
  }

  if (value.type === 'step_sequence') {
    const steps = (value as StepSequenceContent).steps.map(s => ({
      text: s.text[language] ?? s.text['en'] ?? '',
      image: s.image,
    }));
    return { type: 'step_sequence', id, steps } as ResolvedStepSequenceNode;
  }

  // rich_text
  const html = (value as { type: 'rich_text'; value: Record<string, string> }).value[language]
    ?? (value as any).value['en']
    ?? '';
  return { type: 'html', id, html, text: stripHtml(html) } as ResolvedHtmlNode;
};

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Assembles a ResolvedManual from template structure + project data.
 *
 * @param template      The IM template (provides metadata + language list).
 * @param sections      All sections for the template (flat list; tree built internally).
 * @param blocksById    Map of block id → IMBlock for all blocks referenced by sections.
 * @param projectIM     Project-specific data (placeholder values, conditions, sku_content).
 *                      Pass null when resolving for template preview (no project context).
 * @param language      BCP-47 language code to resolve content into.
 * @param projectSkus   The project's SKUs (id + number), used to turn a chapter's
 *                      sectionSkus scope into the "Applies to: …" header numbers, to
 *                      hide a chapter whose scope doesn't intersect the bound SKUs, and to
 *                      pick the SKU the "SKU QR code" chip (QR_SKU_PLACEHOLDER_ID) and
 *                      ResolvedManual.primarySkuQrSvg encode (always the first bound SKU, or
 *                      the first project SKU if unbound). Defaults to [] (no SKU headers, no
 *                      scope-based hiding, and the QR code encodes the site root instead of
 *                      a SKU).
 */
export const resolveManual = (
  template: IMTemplate,
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  // templateType is irrelevant to resolution, so it's optional here — a resolved
  // manual is assembled identically whether it's an IM or a Warning Leaflet.
  projectIM: (Omit<ProjectIM, 'templateType'> & { templateType?: ProjectIM['templateType']; skuContent?: Record<string, SKUContentValue> }) | null,
  language: string,
  projectSkus: Array<{ id: string; skuNumber: string }> = [],
  // Attribute definitions keyed by id, so section conditions are matched with the same
  // data-type-aware logic as the generator. Optional: omit for template preview / tests,
  // where visibility falls back to exact-string equality.
  attributesById: Record<string, CategoryAttribute> = {},
): ResolvedManual => {
  nodeCounter = 0; // reset per resolve call so IDs are stable for the same inputs

  // Copied, never the caller's own object — the QR chip injection below writes into this
  // map, and mutating projectIM.placeholderData in place would leak into the caller's state.
  const placeholderData: Record<string, string> = { ...(projectIM?.placeholderData ?? {}) };
  const conditions: Record<string, boolean | string> = {};
  // Flatten conditions from placeholderData booleans (legacy ProjectIMGenerator stores them as 'true'/'false')
  for (const [k, v] of Object.entries(placeholderData)) {
    if (v === 'true') conditions[k] = true;
    else if (v === 'false') conditions[k] = false;
    else conditions[k] = v;
  }

  const warnings: string[] = [];
  const searchIndex: ResolvedManual['searchIndex'] = [];

  // Per-project content additions layered on top of the template (see ProjectIM).
  const sectionAdditions = projectIM?.sectionAdditions ?? {};

  // Per-chapter SKU scope (see ProjectIM.sectionSkus). SKU ids resolve to numbers for
  // the "Applies to: …" header; a chapter scoped only to unbound SKUs is hidden.
  const sectionSkus = projectIM?.sectionSkus ?? {};
  const skuNumberById = new Map<string, string>();
  for (const s of projectSkus) skuNumberById.set(s.id, s.skuNumber);
  const boundSkuIds = projectIM?.boundSkuIds ?? [];
  // Empty binding = all of the project's SKUs (backward compatible).
  const boundSkuSet = new Set<string>(
    boundSkuIds.length ? boundSkuIds : projectSkus.map(s => s.id),
  );

  // "SKU QR code" chip (see QR_SKU_PLACEHOLDER_ID) and the manual's `primarySkuQrSvg` —
  // always the first bound SKU, so it's unambiguous even for a leaflet template shared
  // across a multi-SKU family. Falls back to the site root (buildSkuQrSvg/skuQrUrl) rather
  // than going blank when the manual has no SKU at all — e.g. a leaflet template assigned
  // to every item in a category rather than to one bound SKU.
  const qrSkuId = boundSkuIds[0] ?? projectSkus[0]?.id;
  const qrSkuNumber = qrSkuId ? skuNumberById.get(qrSkuId) : undefined;
  placeholderData[QR_SKU_PLACEHOLDER_ID] = buildSkuQrSvg(qrSkuNumber);
  // 12mm — placed automatically into the Warning Leaflet's header band (not spliced into
  // body prose, so it isn't tied to the logo's own 8mm height). Sized for reliable scanning
  // rather than to match the logo; buildLeafletHeader below gives the header room to grow.
  const primarySkuQrSvg = buildSkuQrSvg(qrSkuNumber, 12);
  // Resolve a section's SKU scope against the bound SKUs. Returns:
  //   { hidden: true }            → scoped to SKUs, none of which are bound → drop section
  //   { labels: string[] }        → scoped to bound SKUs → render "Applies to: …" numbers
  //   { labels: undefined }       → no scope → applies to all, no header
  const resolveSkuScope = (sectionId: string): { hidden: boolean; labels?: string[] } => {
    const ids = sectionSkus[sectionId];
    if (!ids || ids.length === 0) return { hidden: false };
    const inScope = ids.filter(id => boundSkuSet.has(id));
    if (inScope.length === 0) return { hidden: true };
    const labels = inScope.map(id => skuNumberById.get(id)).filter(Boolean) as string[];
    return { hidden: false, labels: labels.length ? labels : undefined };
  };

  // Build parent → children map
  const childMap = new Map<string | null, IMSection[]>();
  for (const s of sections) {
    const parent = s.parentId ?? null;
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push(s);
  }
  // Project-only sections: treat each as a synthetic IMSection (its inline blocks
  // become blockRefs) so it flows through the same walk + sibling sort as template
  // sections. Their content is never written back to the template.
  for (const extra of projectIM?.extraSections ?? []) {
    const parent = extra.parentId ?? null;
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push({
      id: extra.id,
      templateId: template.id,
      parentId: extra.parentId ?? null,
      title: extra.title,
      order: extra.order,
      isPlaceholder: false,
      content: {},
      blockRefs: extra.blocks,
    });
  }
  for (const children of childMap.values()) {
    children.sort((a, b) => a.order - b.order);
  }

  const resolvedSections: ResolvedSection[] = [];

  const walkSection = (section: IMSection) => {
    if (!isSectionVisible(section, placeholderData, conditions, attributesById)) return;

    // A chapter scoped to specific SKUs, none of which are bound, doesn't apply here.
    const skuScope = resolveSkuScope(section.id);
    if (skuScope.hidden) return;

    const layout = resolveSectionLayout(section, template.metadata?.sectionLayoutMap);
    const nodes: ResolvedNode[] = [];

    // A placeholder section the project has authored: its override blocks fully
    // replace the template's blockRefs + legacy content for this section. An empty
    // override array means "intentionally blank" (no fallback to template content).
    const override = projectIM?.sectionOverrides?.[section.id];
    const refs: BlockRef[] = override ?? (section.blockRefs ?? []);
    const hasInlineRef = refs.some(r => r.kind === 'inline');

    // Hybrid mode: if blockRefs has no inline ref but section.content has free-typed HTML,
    // emit the free-typed content as a leading inline node before the shared block nodes.
    // This lets authors attach shared blocks to any existing section without losing their prose.
    // Skipped entirely when the section is overridden (the override is the full content).
    if (!override && (refs.length === 0 || (!hasInlineRef && (section.content[language] || section.content['en'])))) {
      const rawHtml = section.content[language] ?? section.content['en'] ?? '';
      if (!section.content[language] && section.content['en'] && Object.keys(section.content).length > 0) {
        warnings.push(`section '${section.title}' missing '${language}' content; fell back to 'en'`);
      }
      const html = substituteTokens(
        resolveLegacyChips(rawHtml, placeholderData, conditions),
        placeholderData,
      );
      if (html) {
        const id = nextId('n');
        const node: ResolvedHtmlNode = { type: 'html', id, html, text: stripHtml(html) };
        nodes.push(node);
        searchIndex.push({ sectionId: section.id, nodeId: id, text: node.text });
      }
    }

    // Project additions for this section, sorted by their insertion position.
    // `position` is an index among the template blockRefs (0 = before the first
    // ref, refs.length = after the last). Stale positions past the end are
    // clamped to the end by the `>=` check after the loop.
    const additions = [...(sectionAdditions[section.id] ?? [])].sort((a, b) => a.position - b.position);
    const emitAddition = (addition: ProjectBlockAddition) => {
      const node = resolveInlineRef(addition.block, language, placeholderData, conditions, warnings);
      if (node) {
        nodes.push(node);
        searchIndex.push({ sectionId: section.id, nodeId: node.id, text: (node as ResolvedHtmlNode).text });
      }
    };

    for (let i = 0; i < refs.length; i++) {
      // Emit any project additions anchored before this template ref.
      for (const add of additions) {
        if (add.position === i) emitAddition(add);
      }

      const ref = refs[i];
      let node: ResolvedNode | null = null;

      // Per-ref manual visibility override: keyed by the ref's stable id (`ref:<id>`)
      // when it has one, with the legacy positional `<sectionId>:<index>` key as a
      // fallback for overrides saved before ids existed. (normalizeResolverData expands
      // the persisted `refvis_` keys to these forms.)
      const idKey = ref.id ? `ref:${ref.id}` : null;
      const posKey = `${section.id}:${i}`;
      const refOverride =
        idKey && typeof conditions[idKey] === 'boolean' ? (conditions[idKey] as boolean)
        : typeof conditions[posKey] === 'boolean' ? (conditions[posKey] as boolean)
        : undefined;

      // Per-project inline block override (e.g. an edited table): replace this template
      // inline ref with the project's version. Only inline refs are overridable — shared
      // and sku_slot refs are never touched. Not applied to section overrides (which are
      // already the project's own content). Same id-first, position-fallback keying.
      const overridesForSection = !override ? projectIM?.blockOverrides?.[section.id] : undefined;
      const inlineOverride = (idKey ? overridesForSection?.[idKey] : undefined) ?? overridesForSection?.[String(i)];
      const effectiveRef: BlockRef = (ref.kind === 'inline' && inlineOverride) ? inlineOverride : ref;

      if (effectiveRef.kind === 'inline') {
        node = resolveInlineRef(effectiveRef, language, placeholderData, conditions, warnings, refOverride);
      } else if (ref.kind === 'block') {
        node = resolveSharedBlockRef(ref, blocksById, language, placeholderData, conditions, warnings, refOverride);
      } else if (ref.kind === 'sku_slot') {
        node = resolveSkuSlotRef(ref, projectIM?.skuContent, language, warnings);
      }

      if (node) {
        nodes.push(node);
        if (node.type === 'html' || node.type === 'callout') {
          searchIndex.push({ sectionId: section.id, nodeId: node.id, text: (node as ResolvedHtmlNode).text });
        }
      }
    }

    // Additions anchored at (or past) the end of the section.
    for (const add of additions) {
      if (add.position >= refs.length) emitAddition(add);
    }

    resolvedSections.push({
      id: section.id,
      title: section.titleI18n?.[language]?.trim() ? section.titleI18n[language] : section.title,
      layout,
      parentId: section.parentId ?? null,
      order: section.order,
      ...(skuScope.labels ? { skuScope: skuScope.labels } : {}),
      nodes,
    });

    // Walk children
    for (const child of childMap.get(section.id) ?? []) {
      walkSection(child);
    }
  };

  for (const root of childMap.get(null) ?? []) {
    walkSection(root);
  }

  return {
    schemaVersion: RESOLVED_MANUAL_SCHEMA_VERSION,
    templateId: template.id,
    projectId: projectIM?.id,
    language,
    metadata: template.metadata ?? ({} as any),
    sections: resolvedSections,
    searchIndex,
    warnings,
    primarySkuQrSvg,
  };
};
