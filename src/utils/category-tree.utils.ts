/**
 * Shared helpers for the three-level category tree (L1 > L2 > L3).
 *
 * `getCategories()` already returns leaves in tree order and denormalised with their
 * l1Name/l2Name, so everything here is presentation-only: grouping for the pickers and
 * filtering for the tables. Nothing in here re-derives the hierarchy from names.
 *
 * A leaf with no parent is uncategorised. That is a legitimate state — legacy rows that
 * do not fit the tree are parked there rather than deleted — so it gets a visible bucket
 * instead of being silently dropped from a list.
 */

import { CategoryL3 } from '../types';

export const UNCATEGORISED_LABEL = 'Uncategorised';

/** One `<optgroup>` / table section: an "L1 › L2" heading and the leaves under it. */
export interface CategoryGroup {
  key: string;
  label: string;
  l1Name: string | null;
  l2Name: string | null;
  categories: CategoryL3[];
}

/**
 * Group leaves into "L1 › L2" sections, preserving the tree order they arrive in.
 * Uncategorised leaves collect into a single trailing group.
 */
export const groupByL1L2 = (categories: CategoryL3[]): CategoryGroup[] => {
  const groups = new Map<string, CategoryGroup>();
  for (const c of categories) {
    const key = c.l2Id ?? '__uncategorised__';
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: c.l2Id ? `${c.l1Name} › ${c.l2Name}` : UNCATEGORISED_LABEL,
        l1Name: c.l1Name ?? null,
        l2Name: c.l2Name ?? null,
        categories: [],
      };
      groups.set(key, group);
    }
    group.categories.push(c);
  }
  // Map preserves insertion order, which is tree order — except the uncategorised
  // bucket, which is forced last however early its first member appeared.
  const all = [...groups.values()];
  return [
    ...all.filter(g => g.key !== '__uncategorised__'),
    ...all.filter(g => g.key === '__uncategorised__'),
  ];
};

/** The distinct L1 names present in a leaf list, in tree order. Feeds the L1 filter. */
export const distinctL1 = (categories: CategoryL3[]): string[] =>
  [...new Set(categories.map(c => c.l1Name).filter((n): n is string => !!n))];

/**
 * The distinct L2 names present, in tree order, optionally narrowed to one L1 so the
 * two filter dropdowns stay consistent with each other.
 */
export const distinctL2 = (categories: CategoryL3[], l1Name?: string): string[] =>
  [...new Set(
    categories
      .filter(c => !l1Name || c.l1Name === l1Name)
      .map(c => c.l2Name)
      .filter((n): n is string => !!n),
  )];

export interface CategoryFilters {
  search?: string;
  l1?: string;
  l2?: string;
  /** When false, inactive leaves are hidden. Defaults to showing everything. */
  includeInactive?: boolean;
}

/**
 * Filter leaves for a table view. Search matches on any level, so typing "hobs" finds
 * both the L2 family and its leaves, and typing a leaf name still works when the
 * operator does not remember which family it lives in.
 */
export const filterCategories = (
  categories: CategoryL3[],
  { search, l1, l2, includeInactive = true }: CategoryFilters,
): CategoryL3[] => {
  const q = search?.trim().toLowerCase();
  return categories.filter(c => {
    if (!includeInactive && !c.active) return false;
    if (l1 && c.l1Name !== l1) return false;
    if (l2 && c.l2Name !== l2) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.l2Name ?? '').toLowerCase().includes(q) ||
      (c.l1Name ?? '').toLowerCase().includes(q)
    );
  });
};

/** "Large Appliances › Hobs › Induction Hobs" — for tooltips and single-line contexts. */
export const categoryPath = (c: CategoryL3): string =>
  c.l2Id ? `${c.l1Name} › ${c.l2Name} › ${c.name}` : `${UNCATEGORISED_LABEL} › ${c.name}`;
