/**
 * Pure outline helpers for the Project IM generator's section list.
 *
 * The generator needs to talk about a section's PLACE in the manual, not just its id:
 * hierarchical numbering ("2.3"), depth (for indentation), and — because the resolver
 * skips a hidden section's whole subtree — which ancestor is responsible when a section
 * that is itself included still won't be published.
 *
 * Kept here, dependency-free, so the Setup tab's "Chapters & Sections" list and the
 * Content tab's section tree can number and explain a section identically instead of
 * each rebuilding the tree walk with its own subtle differences.
 */

/** The minimum a section must expose to be placed in the outline. */
export interface OutlineNode {
  id: string;
  parentId?: string | null;
  order: number;
  title: string;
}

export interface OutlinePosition {
  /** Hierarchical number with a trailing dot, e.g. `2.3.` — matches the section tree. */
  prefix: string;
  /** 0 for a chapter, 1 for its sub-sections, and so on. */
  level: number;
}

/**
 * Sections carrying this title are structural metadata, never content. The whole IM module
 * filters them out of every list; the outline must agree or its numbering would count rows
 * the operator can't see.
 */
export const METADATA_SECTION_TITLE = '__METADATA__';

/**
 * Number and indent every section, in document order.
 *
 * Numbering counts only siblings that are actually listed (metadata sections excluded), so
 * "2.3" is the third visible sub-section of the second visible chapter — what the operator
 * counts on screen. A section whose `parentId` points outside the set is treated as a root
 * rather than dropped: an orphan must still be reachable and excludable, since the resolver
 * walks it as a root too.
 */
export const buildSectionOutline = (sections: OutlineNode[]): Record<string, OutlinePosition> => {
  const listed = sections.filter(s => s.title !== METADATA_SECTION_TITLE);
  const ids = new Set(listed.map(s => s.id));
  const byParent = new Map<string | null, OutlineNode[]>();
  for (const s of listed) {
    // An unknown parent means "root" — see the orphan note above.
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(s);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));

  const out: Record<string, OutlinePosition> = {};
  const seen = new Set<string>();
  const walk = (parent: string | null, prefix: string, level: number) => {
    (byParent.get(parent) ?? []).forEach((s, i) => {
      // A cyclic parent chain (corrupt data) must not spin forever — visit each id once.
      if (seen.has(s.id)) return;
      seen.add(s.id);
      const own = `${prefix}${i + 1}.`;
      out[s.id] = { prefix: own, level };
      walk(s.id, own, level + 1);
    });
  };
  walk(null, '', 0);
  return out;
};

/**
 * The nearest ancestor that is excluded, or null when every ancestor is in.
 *
 * This is the "why isn't my section in the manual?" answer: the resolver returns early on a
 * hidden section and never walks its children, so a sub-section left on its default can
 * still be absent because a chapter above it was switched off. Reporting the ancestor by
 * name is the difference between a list that explains itself and one that looks broken.
 *
 * `isExcluded` receives the ancestor's id; a self-referential or cyclic chain terminates.
 */
export const findExcludedAncestor = (
  sectionId: string,
  parentOf: (id: string) => string | null | undefined,
  isExcluded: (id: string) => boolean,
): string | null => {
  const seen = new Set<string>([sectionId]);
  let current = parentOf(sectionId) ?? null;
  while (current && !seen.has(current)) {
    if (isExcluded(current)) return current;
    seen.add(current);
    current = parentOf(current) ?? null;
  }
  return null;
};
