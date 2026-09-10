/**
 * THE ordering rule for TCF sections and the requirements inside them (migration 175).
 *
 * Pure, and singular. Before this existed the same comparator was written out four times —
 * the library, the supplier portal, the internal request detail and its PDF export — and the
 * library's copy disagreed with the other three about where a custom section goes. So the
 * same requirement list genuinely came out in a different order depending on the screen,
 * which is the complaint this module answers. Every surface calls `groupRequirementsBySection`
 * now; nothing sorts sections by hand.
 *
 * TWO LEVELS, both operator-defined:
 *
 *   SECTIONS      by `compliance_sections.sort_order`. Built-in and custom sections are
 *                 ordered by the same column — the six standard ones became rows in
 *                 migration 175 specifically so they could be moved.
 *
 *   REQUIREMENTS  by `sortOrder` within the section, then title as a tiebreak. One number per
 *                 requirement rather than one per (requirement, category), which is what makes
 *                 a global or shared requirement sit in the same place in every category it
 *                 appears in.
 *
 * A section name no requirement uses is still shown by the library (an empty group you can
 * file things into); a section name that is NOT a known row is still shown too, sorted after
 * the known ones. Never dropped: a requirement whose section heading vanished would be a
 * requirement nobody can find.
 */

import type { ComplianceRequirement, ComplianceSection } from '../../types';

/**
 * Where a requirement with no section lands. Matches the label the four old copies of this
 * logic each hard-coded, and the section migration 175 seeds at position 0.
 */
export const DEFAULT_SECTION_NAME = 'General Requirements';

/** The section a requirement belongs to, with blank and missing both resolving to the default. */
export const sectionOf = (req: Pick<ComplianceRequirement, 'section'>): string =>
  req.section?.trim() || DEFAULT_SECTION_NAME;

/**
 * Order section names by the operator's arrangement.
 *
 * Unknown names — a section a requirement still references after the row was deleted — sort
 * after every known one, alphabetically among themselves so the result is deterministic rather
 * than dependent on which requirement happened to be read first.
 */
export const orderSectionNames = (
  names: readonly string[],
  sections: readonly ComplianceSection[],
): string[] => {
  const orderByName = new Map(sections.map(s => [s.name, s.sortOrder]));
  return [...new Set(names)].sort((a, b) => {
    const oa = orderByName.get(a);
    const ob = orderByName.get(b);
    if (oa !== undefined && ob !== undefined) return oa - ob || a.localeCompare(b);
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    return a.localeCompare(b);
  });
};

/** Requirements in their operator-defined order within one section. */
export const orderRequirements = <T extends Pick<ComplianceRequirement, 'sortOrder' | 'title'>>(
  requirements: readonly T[],
  opts: { mandatoryFirst?: boolean } = {},
): T[] => {
  const mandatoryFirst = opts.mandatoryFirst === true;
  return [...requirements].sort((a, b) => {
    if (mandatoryFirst) {
      // The supplier portal offers a "mandatory first" view. It deliberately OUTRANKS the
      // defined order: the operator arranged the list for reading, and this is a supplier
      // asking "what must I do to be compliant at all" — a different question.
      const am = (a as { isMandatory?: boolean }).isMandatory === true;
      const bm = (b as { isMandatory?: boolean }).isMandatory === true;
      if (am !== bm) return am ? -1 : 1;
    }
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.title ?? '').localeCompare(b.title ?? '');
  });
};

export interface RequirementSectionGroup<T> {
  section: string;
  /** False when no `compliance_sections` row carries this name — a stale label on a requirement. */
  isKnownSection: boolean;
  requirements: T[];
}

/**
 * Group requirements into ordered sections, each with its requirements in order. The one
 * function every surface renders from.
 *
 * `includeEmptySections` is for the LIBRARY only: an author needs to see a section group with
 * nothing in it, because that is where they are about to file something. The portal, the
 * request detail and the PDF pass it false — a supplier reading an empty heading learns
 * nothing and wonders what is missing.
 */
export const groupRequirementsBySection = <
  T extends Pick<ComplianceRequirement, 'section' | 'sortOrder' | 'title'>,
>(
  requirements: readonly T[],
  sections: readonly ComplianceSection[],
  opts: { includeEmptySections?: boolean; mandatoryFirst?: boolean } = {},
): RequirementSectionGroup<T>[] => {
  const byName = new Map<string, T[]>();
  for (const req of requirements) {
    const name = sectionOf(req);
    const bucket = byName.get(name);
    if (bucket) bucket.push(req);
    else byName.set(name, [req]);
  }

  const names = opts.includeEmptySections
    ? [...sections.map(s => s.name), ...byName.keys()]
    : [...byName.keys()];

  const known = new Set(sections.map(s => s.name));

  return orderSectionNames(names, sections).map(section => ({
    section,
    isKnownSection: known.has(section),
    requirements: orderRequirements(byName.get(section) ?? [], opts),
  }));
};

/**
 * The `sortOrder` values a reorder should write, as `{ id, sortOrder }` pairs — 0-based,
 * contiguous, in the given order.
 *
 * Returns only the rows whose number actually CHANGES. Dragging one requirement in a list of
 * thirty otherwise rewrites thirty rows, and every one of those is a write the FINAL-lock
 * guard has to check and the history trigger has to consider.
 */
export const reorderPlan = (
  orderedIds: readonly string[],
  current: readonly { id: string; sortOrder?: number }[],
): { id: string; sortOrder: number }[] => {
  const currentById = new Map(current.map(c => [c.id, c.sortOrder ?? 0]));
  return orderedIds
    .map((id, index) => ({ id, sortOrder: index }))
    .filter(next => currentById.get(next.id) !== next.sortOrder);
};

/**
 * The `sortOrder` a NEWLY created requirement should take: the end of its section.
 *
 * Without this a new requirement is written with 0 and ties with whatever already sits at 0,
 * so it lands wherever the title tiebreak puts it — in the middle of a list the operator had
 * arranged. Appending is what "add a requirement" means.
 *
 * Scoped to the same (category, section) pair the reorder UI works on, and it compares
 * `categoryId` strictly so a global requirement (null) is numbered among the other globals
 * rather than among some category's own.
 */
export const nextSortOrder = (
  requirements: readonly Pick<ComplianceRequirement, 'categoryId' | 'section' | 'sortOrder'>[],
  categoryId: string | null,
  section: string | undefined,
): number => {
  const target = section?.trim() || DEFAULT_SECTION_NAME;
  const peers = requirements.filter(
    r => r.categoryId === categoryId && sectionOf(r) === target,
  );
  return peers.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), -1) + 1;
};

/** Move an item from one index to another, returning a new array. Never mutates. */
export const moveInList = <T>(list: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
