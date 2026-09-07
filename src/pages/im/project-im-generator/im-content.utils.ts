/**
 * Pure content helpers for the Project IM generator.
 *
 * Extracted from ProjectIMGenerator.tsx — these depend only on their arguments (no React state),
 * so they live here as standalone, testable functions.
 */

import { AdhocPlaceholder, BlockRef, CategoryAttribute, FeatureConditionFields, IMSection, InlineBlockRef } from '../../../types';

// matchesConditionValue now lives in the shared attribute-condition utils so the resolver
// (published JSON) and this generator (preview/PDF) decide chapter visibility identically.
// Re-exported here to keep existing imports from this module working unchanged.
export { matchesConditionValue } from '../../../utils/attribute-condition.utils';

/** Escape a string for safe inclusion in XML output. */
export const escapeXml = (unsafe: string): string => {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return c;
  });
};

/** Extract all `{{ token }}` names from an HTML fragment. */
export const getTokensInFragment = (html: string): string[] => {
  const out: string[] = [];
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
};

/**
 * The human label for a placeholder or condition node.
 *
 * `data-label` wins when present and decodable; a node that failed to encode falls back rather
 * than showing percent-escapes to the PM. With no attribute at all, a `[Bracketed]` body is the
 * legacy way templates carried the label, so it is unwrapped.
 *
 * Takes the two strings rather than the element: the generator's callers run in the browser, but
 * this logic is the part worth pinning in tests, and the suite has no DOM (`environment: 'node'`).
 */
export const decodePlaceholderLabel = (labelAttr: string | null, text: string, fallback: string): string => {
  if (labelAttr) {
    try {
      return decodeURIComponent(labelAttr);
    } catch {
      return fallback;
    }
  }
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.substring(1, trimmed.length - 1);
  return fallback;
};

/** A ref carries a condition when it requires (or requires the absence of) an attribute. */
export const refHasCondition = (ref: BlockRef): boolean =>
  ref.kind !== 'sku_slot' && !!((ref as FeatureConditionFields).requires_feature || (ref as FeatureConditionFields).requires_feature_absent);

/**
 * Whether a template block can be edited for one project only (stored as a project
 * `blockOverrides` entry instead of changing the template).
 *
 * Any INLINE block can: the point of a project override is the small wording or value tweak
 * that would otherwise force a fork of the shared template.
 *
 * Shared library blocks and SKU slots deliberately cannot. `resolveManual` ignores
 * `blockOverrides` for both — approval-gated compliance content stays locked, and
 * `im-resolver.test.ts` pins that — so offering the action would let a PM type an edit that
 * silently never reaches the published manual.
 */
export const refIsOverridable = (ref: BlockRef): boolean => ref.kind === 'inline';

/**
 * Whether an inline ref's content contains a table in any language.
 *
 * Used only to LABEL an override (a table override also gets the grid controls), never to
 * decide what may be edited — see {@link refIsOverridable}.
 */
export const refHasTable = (ref: BlockRef): boolean =>
  ref.kind === 'inline'
  && Object.values((ref as InlineBlockRef).content || {}).some(h => /<table/i.test(h || ''));

// ---------------------------------------------------------------------------
// Section scanning — extracted from ProjectIMGenerator.tsx (getItemsInSection ~2101,
// getSectionFragments/collectSectionInputs ~2152), which used to close over the
// component's `availableBlocks` state. Parameterized on `blocksById` instead so they can
// run outside the component (the registry lint, §3 of the wizard plan) — behavior is
// otherwise unchanged; the component now imports and calls these instead of its own copies.
//
// DOM-based (DOMParser), so — like the rest of this file's HTML-walking logic — these are
// exercised by the running app rather than by this file's unit tests, which run under
// vitest's default `environment: 'node'` (no DOMParser). `isPlaceholderKeyRegistered` below
// is pulled out specifically so the registry-membership logic stays testable without a DOM.
// ---------------------------------------------------------------------------

/** Minimal shape `getSectionFragments` needs from a shared-block lookup — a structural
 *  subset of the `availableBlocks` state ProjectIMGenerator already keeps. */
export type BlocksById = Record<string, { content: Record<string, string> }>;

/** One `.im-placeholder` chip or `.im-condition` node found in a section's HTML. */
export interface SectionItem {
  id: string;
  kind: 'placeholder' | 'condition';
  type?: 'text' | 'image';
  featureId?: string;
  label?: string;
  conditionLabel?: string;
  always?: boolean;
}

/** Parse every `.im-placeholder` chip and `.im-condition` node out of one HTML fragment. */
export const getItemsInSection = (html: string): SectionItem[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items: SectionItem[] = [];

    const placeholders = doc.querySelectorAll('.im-placeholder');
    placeholders.forEach((el) => {
        const id = el.getAttribute('data-id');
        const type = el.getAttribute('data-type');
        const label = decodePlaceholderLabel(el.getAttribute('data-label'), el.textContent ?? '', type === 'text' ? 'Text Input' : 'Image Upload');

        if (id && type) items.push({ id, kind: 'placeholder', type: type as 'text'|'image', label });
    });

    const conditionNodes = doc.querySelectorAll('.im-condition');
    conditionNodes.forEach((el) => {
        const id = el.getAttribute('data-id');
        const featureId = el.getAttribute('data-feature-id');
        const contentEncoded = el.getAttribute('data-content');
        if (id && featureId) {
            const always = el.getAttribute('data-always') === 'true';
            let snippet = '';
            let conditionLabel = '';
            if (contentEncoded) {
                try {
                    const content = decodeURIComponent(contentEncoded);
                    snippet = content.length > 40 ? content.substring(0, 40) + '...' : content;
                } catch (e) { snippet = 'Error decoding content'; }
            }
            try {
                const cv = el.getAttribute('data-condition-value');
                if (cv && cv !== '*') conditionLabel = decodeURIComponent(cv);
            } catch (e) {}
            const featureName = el.getAttribute('data-feature-name') || '';
            if (always) {
                items.push({ id, kind: 'condition', featureId, label: featureName, conditionLabel: '', always: true });
            } else if (contentEncoded) {
                items.push({ id, kind: 'condition', featureId, label: snippet, conditionLabel });
            }
        }
    });
    return items;
};

/**
 * All content fragments that make up a section in a given language: its own inline
 * content plus every inline ref and shared block it references. Mirrors buildSectionHtml
 * so the config form (and the registry lint) sees exactly what the preview renders.
 */
export const getSectionFragments = (section: IMSection, lang: string, blocksById: BlocksById): string[] => {
    const refs = section.blockRefs ?? [];
    const hasInlineRef = refs.some(r => r.kind === 'inline');
    const frags: string[] = [];
    if (!hasInlineRef) frags.push(section.content[lang] || section.content['en'] || '');
    for (const ref of refs) {
        if (ref.kind === 'inline') {
            frags.push((ref as any).content?.[lang] || (ref as any).content?.['en'] || '');
        } else if (ref.kind === 'block') {
            const blk = blocksById[(ref as any).block_id];
            if (blk) frags.push(blk.content[lang] || blk.content['en'] || '');
        }
    }
    return frags.filter(Boolean);
};

/**
 * Every input a section needs across all its content sources:
 *  - items: placeholders + conditions (deduped by id)
 *  - attrTokens: {{attributeId}} tokens (e.g. SKU number, power) pulled from
 *    inline content AND shared blocks, so bound spec values are verifiable here.
 */
export const collectSectionInputs = (
  section: IMSection,
  lang: string,
  blocksById: BlocksById,
): { items: SectionItem[]; attrTokens: string[] } => {
    const seenItems = new Set<string>();
    const items: SectionItem[] = [];
    const seenTokens = new Set<string>();
    const attrTokens: string[] = [];
    for (const html of getSectionFragments(section, lang, blocksById)) {
        for (const it of getItemsInSection(html)) {
            if (!seenItems.has(it.id)) { seenItems.add(it.id); items.push(it); }
        }
        for (const tok of getTokensInFragment(html)) {
            if (!seenTokens.has(tok)) { seenTokens.add(tok); attrTokens.push(tok); }
        }
    }
    return { items, attrTokens };
};

/**
 * Whether a placeholder/token key already resolves against the registry: an attribute-bound
 * chip or `{{token}}` uses the attribute's own id as its key (see InlineBlockEditor.tsx —
 * `id = attrId || initial?.id || createId()`), so it resolves via `attributesById`; an
 * unbound `.im-placeholder` chip resolves via its `im_adhoc_placeholders` row instead.
 * Pulled out as its own pure function so the registry-membership rule is unit-testable
 * without a DOM fixture (see the module doc above).
 */
export const isPlaceholderKeyRegistered = (
  key: string,
  attributesById: Record<string, CategoryAttribute>,
  adhocById: Record<string, AdhocPlaceholder>,
): boolean => !!attributesById[key] || !!adhocById[key];

