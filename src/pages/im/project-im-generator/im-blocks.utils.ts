/**
 * Pure block helpers for the Project IM generator.
 *
 * Extracted from ProjectIMGenerator.tsx — these depend only on their arguments (no React state),
 * so they live here as standalone, testable functions. Where the original read component state
 * directly (`sectionOverrides`, `availableBlocks`), that state is now passed in, the same way
 * `joinAttrValues` takes the submitted values it needs.
 */

import { CalloutVariant, IMSection, InlineBlockRef, SharedBlockRef } from '../../../types';

/** The shared block library, keyed by block id, as the generator holds it. */
export type AvailableBlocks = Record<string, { content: Record<string, string>; blockType: string }>;

/** A fresh, empty inline block. */
export const newInlineBlock = (): InlineBlockRef => ({ kind: 'inline', content: {} });

/** Map a shared block's `blockType` onto the callout variant that renders it. */
export const blockTypeToVariant = (blockType?: string): CalloutVariant | undefined => {
  const map: Record<string, CalloutVariant> = { warning: 'warning', danger: 'danger', caution: 'caution', electric: 'electric', flammable: 'flammable', hot_surface: 'hot_surface', info: 'info' };
  return blockType ? map[blockType] : undefined;
};

/**
 * The blocks a placeholder section starts from before the PM has edited it: its own inline
 * refs, else its legacy content as a single block, else one empty block. Never returns an
 * empty array — the editor always needs something to render.
 */
export const seedPlaceholderBlocks = (section: IMSection): InlineBlockRef[] => {
  const inlineRefs = (section.blockRefs ?? []).filter(r => r.kind === 'inline') as InlineBlockRef[];
  if (inlineRefs.length) return inlineRefs.map(r => ({ kind: 'inline', content: { ...r.content }, variant: r.variant }));
  if (Object.values(section.content || {}).some(v => v)) return [{ kind: 'inline', content: { ...section.content } }];
  return [{ kind: 'inline', content: {} }];
};

/**
 * Copy a section's content into standalone inline blocks for a duplicated project chapter:
 * inline refs are copied as-is; shared blocks are flattened to inline (keeping their callout
 * look); a legacy content-only section becomes one block; sku_slot refs are dropped (per-SKU
 * typed content is out of scope for duplication).
 */
export const sectionToInlineBlocks = (
  section: IMSection,
  sectionOverrides: Record<string, InlineBlockRef[]>,
  availableBlocks: AvailableBlocks,
): InlineBlockRef[] => {
  const refs = sectionOverrides[section.id] ?? (section.blockRefs ?? []);
  const out: InlineBlockRef[] = [];
  if (refs.length === 0) {
    if (Object.values(section.content || {}).some(v => v)) out.push({ kind: 'inline', content: { ...section.content } });
  } else {
    for (const ref of refs) {
      if (ref.kind === 'inline') {
        out.push({ kind: 'inline', content: { ...(ref as InlineBlockRef).content }, variant: (ref as InlineBlockRef).variant });
      } else if (ref.kind === 'block') {
        const blk = availableBlocks[(ref as SharedBlockRef).block_id];
        if (blk) out.push({ kind: 'inline', content: { ...blk.content }, variant: blockTypeToVariant(blk.blockType) });
      }
      // sku_slot: intentionally skipped.
    }
  }
  return out.length ? out : [{ kind: 'inline', content: {} }];
};

/** Whether a block carries no text in any language once markup is stripped. */
export const isInlineBlockEmpty = (block: InlineBlockRef): boolean =>
  Object.values(block.content || {}).every(v => !String(v || '').replace(/<[^>]*>/g, '').trim());

/** Whether a section is a project-only chapter rather than one from the template. */
export const isExtraSection = (section: IMSection): boolean => (section as any).__projectExtra === true;
