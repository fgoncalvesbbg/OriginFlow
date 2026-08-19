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
 *
 * FRAGMENT IDS ARE ID-BASED, NOT POSITIONAL
 * -----------------------------------------
 * A fragment id addresses a block ref by its stable `blockRefs[].id` UUID (the one
 * `saveIMSection` mints and project overrides already key on as `ref:<uuid>`), not
 * by its array index.
 *
 * This is a CORRECTNESS fix, not tidiness. With a positional id, reordering two
 * rows of the same kind between exporting an XLIFF file and importing it back
 * silently writes row 1's translation into row 3: the index still resolves and the
 * ref kind still matches, so nothing detects the swap. The old `applyTranslationFragment`
 * only returned null when the index was out of range or the KIND differed, which a
 * same-kind reorder passes straight through. In a regulated manual that means a
 * safety warning can end up under the wrong heading with no warning at all.
 *
 * Grammar, oldest form last:
 *
 *   <sectionId>#title                      section title           (always stable)
 *   <sectionId>#legacy                     legacy section content  (always stable)
 *   <sectionId>#inline:ref:<uuid>          inline block            (stable)
 *   <sectionId>#sku_label:ref:<uuid>       sku-slot label          (stable)
 *   <sectionId>#inline:<index>             inline block            (LEGACY, positional)
 *   <sectionId>#sku_label:<index>          sku-slot label          (LEGACY, positional)
 *
 * Both forms resolve on import, because a file exported before this change must
 * still be importable. `isLegacyPositionalFragmentId` and `hasLegacyPositionalIds`
 * let the import preview warn that a reordered row cannot be detected in such a
 * file. Refs acquire ids on the next `saveIMSection`, so coverage converges on its
 * own; `duplicateIMTemplate` strips and re-mints them, so clones always have them.
 */
import { IMSection, InlineBlockRef, SKUSlotRef } from '../../types';

export type TranslationFragmentKind = 'title' | 'inline' | 'sku_label' | 'legacy';

export interface TranslationFragment {
  /** See the grammar in the file docstring. */
  id: string;
  kind: TranslationFragmentKind;
  sectionId: string;
  /** Array position at collection time — for display only, never for resolution. */
  refIndex?: number;
  /** The stable `blockRefs[].id`, when the ref has one. */
  refId?: string;
  /** Human-readable breadcrumb for translator context (XLIFF <note>) and reports. */
  label: string;
  sourceHtml: string;
}

/**
 * Build an id that addresses a ref by its stable uuid when it has one, by index
 * otherwise.
 *
 * Exported because the AI translate flow in IMTemplateEditor builds its own task list
 * rather than going through `collectTranslationFragments`, and the two MUST agree on
 * ids: a mismatch would silently mean the translation memory never matches anything the
 * AI path looks up, which looks like "the memory just doesn't work" rather than a bug.
 */
export const refFragmentId = (
  sectionId: string,
  kind: 'inline' | 'sku_label',
  refIndex: number,
  refId?: string,
): string =>
  refId
    ? `${sectionId}#${kind}:ref:${refId}`
    : `${sectionId}#${kind}:${refIndex}`;

/** Fragment id for a whole-section slot (its title, or its legacy content). */
export const sectionFragmentId = (sectionId: string, kind: 'title' | 'legacy'): string =>
  `${sectionId}#${kind}`;

interface ParsedFragmentId {
  sectionId: string;
  kind: TranslationFragmentKind;
  /** Set for the stable form. */
  refId?: string;
  /** Set for the legacy positional form. */
  refIndex?: number;
}

/**
 * Parse a fragment id of either form. Returns null for anything unrecognized, so a
 * malformed or hand-edited id is reported as a failure rather than guessed at.
 */
export const parseTranslationFragmentId = (fragmentId: string): ParsedFragmentId | null => {
  const hashIdx = fragmentId.indexOf('#');
  if (hashIdx <= 0) return null;
  const sectionId = fragmentId.slice(0, hashIdx);
  const field = fragmentId.slice(hashIdx + 1);
  const parts = field.split(':');
  const kind = parts[0];

  if (kind === 'title' || kind === 'legacy') {
    return parts.length === 1 ? { sectionId, kind } : null;
  }
  if (kind !== 'inline' && kind !== 'sku_label') return null;

  if (parts[1] === 'ref') {
    // A uuid contains no colons, but rejoin defensively rather than truncate an id.
    const refId = parts.slice(2).join(':');
    return refId ? { sectionId, kind, refId } : null;
  }
  const refIndex = Number(parts[1]);
  if (parts.length !== 2 || !Number.isInteger(refIndex) || refIndex < 0) return null;
  return { sectionId, kind, refIndex };
};

/**
 * True when this id addresses a block ref by ARRAY POSITION, so a reorder between
 * export and import cannot be detected.
 */
export const isLegacyPositionalFragmentId = (fragmentId: string): boolean => {
  const parsed = parseTranslationFragmentId(fragmentId);
  return !!parsed && parsed.refIndex !== undefined;
};

/**
 * True when a set of imported unit ids contains no stable ref id at all — i.e. the
 * file predates the id-based scheme, and the import preview should say that a
 * reordered row cannot be detected.
 */
export const hasLegacyPositionalIds = (fragmentIds: readonly string[]): boolean =>
  fragmentIds.some(isLegacyPositionalFragmentId);

type ResolvedRef = { ref: NonNullable<IMSection['blockRefs']>[number]; index: number };

/**
 * Resolve a parsed id to a concrete ref: by uuid for the stable form (so it follows
 * the row through a reorder), by array position for a legacy file.
 */
const resolveRef = (section: IMSection, parsed: ParsedFragmentId): ResolvedRef | null => {
  const refs = section.blockRefs ?? [];
  const index =
    parsed.refId !== undefined
      ? refs.findIndex((r) => r.id === parsed.refId)
      : parsed.refIndex ?? -1;
  if (index < 0 || index >= refs.length) return null;
  return { ref: refs[index], index };
};

export const collectTranslationFragments = (
  sections: IMSection[],
  sourceLang = 'en',
): TranslationFragment[] => {
  const fragments: TranslationFragment[] = [];

  for (const s of sections) {
    const titleSrc = s.titleI18n?.[sourceLang] ?? s.title;
    if (titleSrc && titleSrc.trim()) {
      fragments.push({
        id: sectionFragmentId(s.id, 'title'),
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
            id: refFragmentId(s.id, 'inline', idx, ref.id),
            kind: 'inline',
            sectionId: s.id,
            refIndex: idx,
            refId: ref.id,
            label: `Section "${s.title}" (row ${idx + 1})`,
            sourceHtml: src,
          });
        }
      } else if (ref.kind === 'sku_slot') {
        const src = ref.label?.[sourceLang];
        if (src && src.trim()) {
          fragments.push({
            id: refFragmentId(s.id, 'sku_label', idx, ref.id),
            kind: 'sku_label',
            sectionId: s.id,
            refIndex: idx,
            refId: ref.id,
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
          id: sectionFragmentId(s.id, 'legacy'),
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
 * Read the CURRENT value of the target-language slot named by `fragmentId` —
 * the read counterpart of applyTranslationFragment, used to tell "fills a blank"
 * apart from "overwrites an existing translation" before an import is committed.
 * Returns null when the id doesn't resolve (structure changed) — those units are
 * skipped by the import anyway.
 */
export const readTranslationFragmentValue = (
  sections: IMSection[],
  fragmentId: string,
  targetLang: string,
): string | null => {
  const parsed = parseTranslationFragmentId(fragmentId);
  if (!parsed) return null;
  const s = sections.find((sec) => sec.id === parsed.sectionId);
  if (!s) return null;

  if (parsed.kind === 'title') return s.titleI18n?.[targetLang] ?? null;
  if (parsed.kind === 'legacy') return s.content?.[targetLang] ?? null;

  const hit = resolveRef(s, parsed);
  if (!hit) return null;
  if (parsed.kind === 'inline') {
    return hit.ref.kind === 'inline' ? (hit.ref.content?.[targetLang] ?? null) : null;
  }
  return hit.ref.kind === 'sku_slot' ? (hit.ref.label?.[targetLang] ?? null) : null;
};

/**
 * Write `html` into the target-language slot named by `fragmentId`, on a copy of
 * `sections`. Returns null (no changes made) when the id no longer resolves — the
 * section was deleted, or the referenced row was removed or retyped since the
 * fragment was collected — so the caller can report a "structure changed since
 * export" warning instead of writing to the wrong place.
 *
 * With an id-based fragment id a REORDER no longer resolves to the wrong row: the
 * uuid follows the row. With a legacy positional id it still cannot be detected,
 * which is what `hasLegacyPositionalIds` exists to warn about.
 */
export const applyTranslationFragment = (
  sections: IMSection[],
  fragmentId: string,
  targetLang: string,
  html: string,
): IMSection[] | null => {
  const parsed = parseTranslationFragmentId(fragmentId);
  if (!parsed) return null;
  const sIdx = sections.findIndex((s) => s.id === parsed.sectionId);
  if (sIdx === -1) return null;
  const s = sections[sIdx];

  if (parsed.kind === 'title') {
    const updated: IMSection = { ...s, titleI18n: { ...(s.titleI18n ?? {}), [targetLang]: html } };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }
  if (parsed.kind === 'legacy') {
    const updated: IMSection = { ...s, content: { ...s.content, [targetLang]: html } };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }

  const hit = resolveRef(s, parsed);
  if (!hit || !s.blockRefs) return null;
  const { ref, index } = hit;

  if (parsed.kind === 'inline') {
    if (ref.kind !== 'inline') return null;
    const updatedRef: InlineBlockRef = { ...ref, content: { ...ref.content, [targetLang]: html } };
    const updatedRefs = s.blockRefs.map((r, i) => (i === index ? updatedRef : r));
    const updated: IMSection = { ...s, blockRefs: updatedRefs };
    return sections.map((sec, i) => (i === sIdx ? updated : sec));
  }

  if (ref.kind !== 'sku_slot') return null;
  const updatedRef: SKUSlotRef = { ...ref, label: { ...ref.label, [targetLang]: html } };
  const updatedRefs = s.blockRefs.map((r, i) => (i === index ? updatedRef : r));
  const updated: IMSection = { ...s, blockRefs: updatedRefs };
  return sections.map((sec, i) => (i === sIdx ? updated : sec));
};
