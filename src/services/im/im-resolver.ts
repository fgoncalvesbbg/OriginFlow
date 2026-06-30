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

// ISO 7010 W001 — General Warning / Caution
const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
// ISO 7010 W012 — Electrical Hazard
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
// ISO 7000-0190 / M002 — Information
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;
// ISO 7010 W021 — Flammable material (official ISO_7010_W021 artwork)
const ISO_W021 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M 597.6,499.6 313.8,8 C 310.9,3 305.6,0 299.9,0 294.2,0 288.9,3.1 286,8 L 2.2,499.6 c -2.9,5 -2.9,11.1 0,16 2.9,5 8.2,8 13.9,8 h 567.6 c 5.7,0 11,-3.1 13.9,-8 2.9,-5 2.9,-11.1 0,-16 z" fill="#231F20"/><polygon points="43.875,491.5 299.875,48.2 555.875,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><path d="m 254.20599,412.70348 c -23.76019,-10.34209 -33.09455,-30.39188 -35.71706,-76.71863 -1.06141,-18.75 -1.13418,-34.09091 -0.16169,-34.09091 0.97249,0 4.29519,1.35243 7.38379,3.00539 4.98824,2.66964 5.99798,1.23079 9.03804,-12.87878 1.88233,-8.7363 4.23436,-21.75719 5.22673,-28.9353 l 1.80431,-13.05112 9.88246,9.57846 9.88247,9.57846 2.12479,-22.67469 c 1.16864,-12.47108 1.16355,-27.05119 -0.0112,-32.40024 -2.00776,-9.14129 -1.75819,-9.52331 4.15445,-6.35896 3.45979,1.85162 7.7334,6.06261 9.4969,9.35775 5.94987,11.11759 9.05366,6.09812 9.05366,-14.64178 0,-13.03057 1.58382,-22.79895 4.2985,-26.51149 4.12866,-5.64628 4.38304,-5.54174 6.43797,2.64577 1.17671,4.68838 8.03213,15.42775 15.23426,23.86526 7.20212,8.43751 13.64618,18.9181 14.32012,23.29019 l 1.22533,7.94926 0.45403,-8.33333 c 0.57982,-10.64199 4.12382,-10.5344 13.32837,0.4046 6.66394,7.91962 10.13451,17.48588 16.069,44.29237 1.93451,8.73845 2.1136,8.82656 4.61879,2.27273 3.3383,-8.7334 6.86421,-8.63774 11.65621,0.31623 4.67369,8.73288 5.39436,24.48257 2.30806,50.44134 -2.07621,17.46282 -1.84452,19.07567 2.04276,14.21936 4.04869,-5.05797 4.53933,-4.56179 6.4043,6.47691 2.55164,15.10294 -2.7687,35.42364 -12.71633,48.56921 -9.97903,13.18712 -34.5024,24.60594 -52.92676,24.6443 -17.95679,0.0373 -20.42284,-3.76866 -7.41467,-11.44366 11.92246,-7.03443 24.03985,-22.06988 30.77215,-38.18258 4.52855,-10.83827 4.49197,-11.358 -0.68324,-9.71542 -4.83224,1.53367 -5.35055,0.0658 -4.4593,-12.62848 l 1.00842,-14.36388 -7.91642,11.36363 c -10.00264,14.35834 -14.15034,14.55197 -10.26464,0.47915 3.75124,-13.58587 0.74797,-33.0383 -7.09173,-45.93369 -3.29306,-5.41667 -6.46488,-9.84849 -7.04853,-9.84849 -0.58364,0 -1.01554,11.25 -0.95978,25 0.0994,24.51621 -3.69021,41.66667 -9.20685,41.66667 -1.52966,0 -4.90224,-5.11364 -7.49462,-11.36364 l -4.71341,-11.36363 -0.46317,10.60606 c -0.25472,5.83333 -0.22051,15.03788 0.076,20.45454 0.29655,5.41667 -0.85159,9.84849 -2.55145,9.84849 -5.08631,0 -12.55008,-12.86679 -14.502,-25 -2.00506,-12.46355 -6.84316,-15.36643 -7.57568,-4.54546 -0.9802,14.47946 -1.44911,15.88549 -5.04602,15.13052 -8.24799,-1.73121 3.85695,30.08491 17.24971,45.33839 5.20849,5.93215 9.46999,11.62842 9.46999,12.65842 0,3.31249 -16.373,1.76328 -26.09704,-2.4693 z M 185,455 l 0,-25 230,0 0,25 z" fill="#231F20"/></svg>`;

const ISO_ICONS: Record<string, string> = { warning: ISO_W001, caution: ISO_W001, electric: ISO_W012, flammable: ISO_W021, info: ISO_M002 };

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

import { getCalloutTitle } from './callout-titles.i18n';
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
    caution: 'caution',
    electric: 'electric',
    flammable: 'flammable',
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
): boolean => {
  if (!section.conditionFeatureId) return true;
  if (section.conditionFeatureId === 'manual') {
    return conditions[section.id] !== false;
  }
  const actual = placeholderData[section.conditionFeatureId] ?? conditions[section.conditionFeatureId];
  if (actual === undefined) return false;
  if (!section.conditionLabel || section.conditionLabel === 'any') return true;
  return String(actual) === section.conditionLabel;
};

// ---------------------------------------------------------------------------
// Block-ref resolvers
// ---------------------------------------------------------------------------

// passesFeatureGate / isFalsy now live in src/utils/attribute-condition.utils.ts so the
// compliance module can reuse the same attribute-condition logic. Re-exported here to
// keep existing IM imports (and tests) working unchanged.
import { passesFeatureGate } from '../../utils/attribute-condition.utils';
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
 */
export const resolveManual = (
  template: IMTemplate,
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  // templateType is irrelevant to resolution, so it's optional here — a resolved
  // manual is assembled identically whether it's an IM or a Warning Leaflet.
  projectIM: (Omit<ProjectIM, 'templateType'> & { templateType?: ProjectIM['templateType']; skuContent?: Record<string, SKUContentValue> }) | null,
  language: string,
): ResolvedManual => {
  nodeCounter = 0; // reset per resolve call so IDs are stable for the same inputs

  const placeholderData: Record<string, string> = projectIM?.placeholderData ?? {};
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
    if (!isSectionVisible(section, placeholderData, conditions)) return;

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

      // Per-ref manual visibility override, keyed by `<sectionId>:<index>`
      // (normalizeResolverData expands the persisted `refvis_` keys to this form).
      const refKey = `${section.id}:${i}`;
      const refOverride = typeof conditions[refKey] === 'boolean' ? (conditions[refKey] as boolean) : undefined;

      if (ref.kind === 'inline') {
        node = resolveInlineRef(ref, language, placeholderData, conditions, warnings, refOverride);
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
  };
};
