/**
 * Rebuilds the chapter hierarchy from the flat ResolvedManual sections using parentId/order.
 * (schemaVersion 2 added parentId/order specifically so renderers can do this.)
 */

import { ManualSection } from './types';

export interface SectionTreeNode {
  section: ManualSection;
  depth: number;
  children: SectionTreeNode[];
}

const sortByOrder = (a: ManualSection, b: ManualSection) => a.order - b.order;

export const buildSectionTree = (sections: ManualSection[]): SectionTreeNode[] => {
  const byParent = new Map<string | null, ManualSection[]>();
  for (const s of sections) {
    const key = s.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }
  for (const list of byParent.values()) list.sort(sortByOrder);

  const build = (parentId: string | null, depth: number): SectionTreeNode[] =>
    (byParent.get(parentId) ?? []).map((section) => ({
      section,
      depth,
      children: build(section.id, depth + 1),
    }));

  // Roots: anything whose parentId is null OR points to a section not present in the set.
  const ids = new Set(sections.map((s) => s.id));
  const roots = sections
    .filter((s) => !s.parentId || !ids.has(s.parentId))
    .sort(sortByOrder);

  // Avoid double-counting orphans whose parent is missing — build their subtrees explicitly.
  return roots.map((section) => ({
    section,
    depth: 0,
    children: build(section.id, 1),
  }));
};

/** Depth-first reading order with depth, matching the tree above. */
export const flattenInReadingOrder = (
  nodes: SectionTreeNode[],
): Array<{ section: ManualSection; depth: number }> => {
  const out: Array<{ section: ManualSection; depth: number }> = [];
  const walk = (list: SectionTreeNode[]) => {
    for (const n of list) {
      out.push({ section: n.section, depth: n.depth });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
};
