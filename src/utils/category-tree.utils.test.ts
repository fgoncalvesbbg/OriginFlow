import { describe, it, expect } from 'vitest';
import {
  groupByL1L2,
  distinctL1,
  distinctL2,
  filterCategories,
  categoryPath,
  UNCATEGORISED_LABEL,
} from './category-tree.utils';
import { CategoryL3 } from '../types';

const leaf = (over: Partial<CategoryL3> & { name: string }): CategoryL3 => ({
  id: over.name.toLowerCase().replace(/\s+/g, '-'),
  active: true,
  isFinalized: false,
  ...over,
});

// Mirrors the seeded tree closely enough to catch the real edge cases: a leaf name that
// exists under two different families, and an unparented legacy row.
const CATEGORIES: CategoryL3[] = [
  leaf({ name: 'Induction Hobs', l1Name: 'Large Appliances', l2Name: 'Hobs', l2Id: 'hobs' }),
  leaf({ name: 'Gas Hobs', l1Name: 'Large Appliances', l2Name: 'Hobs', l2Id: 'hobs' }),
  leaf({ name: 'Angled Hoods', l1Name: 'Large Appliances', l2Name: 'Range Hoods', l2Id: 'hoods' }),
  leaf({ name: 'Raclette Grills', l1Name: 'Small Appliances', l2Name: 'Electric Grills', l2Id: 'sa-grills' }),
  leaf({ name: 'Electric Grills', l1Name: 'Garden', l2Name: 'Grills', l2Id: 'g-grills' }),
  leaf({ name: 'Hobs - Test', active: false }),
];

describe('groupByL1L2', () => {
  it('groups leaves under an "L1 › L2" heading, preserving input order', () => {
    const groups = groupByL1L2(CATEGORIES);
    expect(groups.map(g => g.label)).toEqual([
      'Large Appliances › Hobs',
      'Large Appliances › Range Hoods',
      'Small Appliances › Electric Grills',
      'Garden › Grills',
      UNCATEGORISED_LABEL,
    ]);
    expect(groups[0].categories.map(c => c.name)).toEqual(['Induction Hobs', 'Gas Hobs']);
  });

  it('puts the uncategorised bucket last even when it appears first', () => {
    const groups = groupByL1L2([
      leaf({ name: 'Orphan' }),
      leaf({ name: 'Gas Hobs', l1Name: 'Large Appliances', l2Name: 'Hobs', l2Id: 'hobs' }),
    ]);
    expect(groups.map(g => g.label)).toEqual(['Large Appliances › Hobs', UNCATEGORISED_LABEL]);
  });

  it('keeps same-named leaves in separate groups', () => {
    // "Electric Grills" is a Small Appliances L2 and a Garden leaf. Grouping by l2Id, not
    // by name, is what stops the two collapsing into one.
    const groups = groupByL1L2(CATEGORIES);
    const garden = groups.find(g => g.label === 'Garden › Grills');
    expect(garden?.categories.map(c => c.name)).toEqual(['Electric Grills']);
  });
});

describe('distinctL1 / distinctL2', () => {
  it('lists each L1 once, in tree order, ignoring unparented leaves', () => {
    expect(distinctL1(CATEGORIES)).toEqual(['Large Appliances', 'Small Appliances', 'Garden']);
  });

  it('narrows L2 to the selected L1', () => {
    expect(distinctL2(CATEGORIES, 'Large Appliances')).toEqual(['Hobs', 'Range Hoods']);
    expect(distinctL2(CATEGORIES)).toEqual(['Hobs', 'Range Hoods', 'Electric Grills', 'Grills']);
  });
});

describe('filterCategories', () => {
  it('matches the search against any level', () => {
    // "hobs" is an L2 name; every leaf in that family must come back, not just a name match.
    expect(filterCategories(CATEGORIES, { search: 'hobs' }).map(c => c.name))
      .toEqual(['Induction Hobs', 'Gas Hobs', 'Hobs - Test']);
    expect(filterCategories(CATEGORIES, { search: 'garden' }).map(c => c.name))
      .toEqual(['Electric Grills']);
  });

  it('combines L1 and L2 filters', () => {
    expect(filterCategories(CATEGORIES, { l1: 'Large Appliances', l2: 'Hobs' }).map(c => c.name))
      .toEqual(['Induction Hobs', 'Gas Hobs']);
  });

  it('hides inactive leaves only when asked', () => {
    expect(filterCategories(CATEGORIES, {}).map(c => c.name)).toContain('Hobs - Test');
    expect(filterCategories(CATEGORIES, { includeInactive: false }).map(c => c.name))
      .not.toContain('Hobs - Test');
  });

  it('ignores case and surrounding whitespace in the search', () => {
    expect(filterCategories(CATEGORIES, { search: '  INDUCTION ' }).map(c => c.name))
      .toEqual(['Induction Hobs']);
  });

  it('returns everything when no filters are set', () => {
    expect(filterCategories(CATEGORIES, {})).toHaveLength(CATEGORIES.length);
  });
});

describe('categoryPath', () => {
  it('renders the full path for a filed leaf', () => {
    expect(categoryPath(CATEGORIES[0])).toBe('Large Appliances › Hobs › Induction Hobs');
  });

  it('marks an unparented leaf as uncategorised rather than showing nulls', () => {
    expect(categoryPath(leaf({ name: 'Orphan' }))).toBe(`${UNCATEGORISED_LABEL} › Orphan`);
  });
});
