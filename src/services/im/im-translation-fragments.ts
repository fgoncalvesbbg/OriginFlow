/**
 * Walks IM template sections the same way the AI "Translate" flow does
 * (`IMTemplateEditor.tsx` `handleTranslate`) — section title, each inline block's
 * content, each sku-slot label, and legacy section content when there are no
 * blockRefs — but instead of calling the AI, collects each translatable English
 * fragment for external export, and re-resolves a fragment id back onto live
 * sections when a translated file is imported.
 *
 * Shared blocks (`kind:'block'`) are intentionally skipped, same as AI translate:
 * they're edited from the block library, not per-template.
 */
import { IMSection, InlineBlockRef, SKUSlotRef } from '../../types';

export type TranslationFragmentKind = 'title' | 'inline' | 'sku_label' | 'legacy';

export interface TranslationFragment {
  /** `${sectionId}#title` | `${sectionId}#inline:${idx}` | `${sectionId}#sku_label:${idx}` | `${sectionId}#legacy` */
  id: string;
  kind: TranslationFragmentKind;
  sectionId: string;
  refIndex?: number;
  /** Human-readable breadcrumb for translator context (XLIFF <note>) and reports. */
  label: string;
  sourceHtml: string;
}

const fragmentId = (sectionId: string, kind: TranslationFragmentKind, refIndex?: number): string =>
  refIndex === undefined ? `${sectionId}#${kind}` : `${sectionId}#${kind}:${refIndex}`;

export const collectTranslationFragments = (
  sections: IMSection[],
  sourceLang = 'en',
): TranslationFragment[] => {
  const fragments: TranslationFragment[] = [];

  for (const s of sections) {
    const titleSrc = s.titleI18n?.[sourceLang] ?? s.title;
    if (titleSrc && titleSrc.trim()) {
      fragments.push({
        id: fragmentId(s.id, 'title'),
        kind: 'title',
        sectionId: s.id,
        label: `Section "${s.title}" — title`,
        sourceHtml: titleSrc,
      });
    }

    const refs = s.blockRefs ?? [];
    refs.forEach((ref, idx) => {
      if (ref.kind === 'inline') {
        const src = ref.content?.[sourceLang];
        if (src && src.trim()) {
          fragments.push({
            id: fragmentId(s.id, 'inline', idx),
            kind: 'inline',
            sectionId: s.id,
            refIndex: idx,
            label: `Section "${s.title}" (row ${idx + 1})`,
            sourceHtml: src,
          });
        }
      } else if (ref.kind === 'sku_slot') {
        const src = ref.label?.[sourceLang];
        if (src && src.trim()) {
          fragments.push({
            id: fragmentId(s.id, 'sku_label', idx),
            kind: 'sku_label',
            sectionId: s.id,
            refIndex: idx,
            label: `Field in section "${s.title}"`,
            sourceHtml: src,
          });
        }
      }
      // ref.kind === 'block' (shared) intentionally skipped — see file docstring.
    });

    if (refs.length === 0) {
      const src = s.content?.[sourceLang];
      if (src && src.trim()) {
        fragments.push({
          id: fragmentId(s.id, 'legacy'),
          kind: 'legacy',
          sectionId: s.id,
          label: `Section "${s.title}"`,
          sourceHtml: src,
        });
      }
    }
  }

  return fragments;
};

/**
 * Write `html` into the target-language slot named by `fragmentId`, on a copy of
 * `sections`. Returns null (no changes made) when the id no longer resolves —
 * the section was deleted, or the referenced row was reordered/retyped/removed
 * since the fragment was collected — so the caller can report a "structure
 * changed since export" warning instead of writing to the wrong place.
 */
export const applyTranslationFragment = (
  sections: IMSection[],
  fragmentId: string,
  targetLang: string,
  html: string,
): IMSection[] | null => {
  const hashIdx = fragmentId.indexOf('#');
  if (hashIdx === -1) return null;
  const sectionId = fragmentId.slice(0, hashIdx);
  const field = fragmentId.slice(hashIdx + 1);
  const sIdx = sections.findIndex(s => s.id === sectionId);
  if (sIdx === -1) return null;

  const [kind, idxStr] = field.split(':');
  const refIndex = idxStr !== undefined ? Number(idxStr) : undefined;
  const s = sections[sIdx];

  if (kind === 'title') {
    const updated: IMSection = { ...s, titleI18n: { ...(s.titleI18n ?? {}), [targetLang]: html } };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }
  if (kind === 'legacy') {
    const updated: IMSection = { ...s, content: { ...s.content, [targetLang]: html } };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }
  if (refIndex === undefined || Number.isNaN(refIndex) || !s.blockRefs || refIndex < 0 || refIndex >= s.blockRefs.length) {
    return null;
  }
  const ref = s.blockRefs[refIndex];

  if (kind === 'inline') {
    if (ref.kind !== 'inline') return null;
    const updatedRef: InlineBlockRef = { ...ref, content: { ...ref.content, [targetLang]: html } };
    const updatedRefs = s.blockRefs.map((r, i) => (i === refIndex ? updatedRef : r));
    const updated: IMSection = { ...s, blockRefs: updatedRefs };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }
  if (kind === 'sku_label') {
    if (ref.kind !== 'sku_slot') return null;
    const updatedRef: SKUSlotRef = { ...ref, label: { ...ref.label, [targetLang]: html } };
    const updatedRefs = s.blockRefs.map((r, i) => (i === refIndex ? updatedRef : r));
    const updated: IMSection = { ...s, blockRefs: updatedRefs };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }
  return null;
};
