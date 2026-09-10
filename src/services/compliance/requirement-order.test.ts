import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SECTION_NAME,
  groupRequirementsBySection,
  moveInList,
  orderRequirements,
  orderSectionNames,
  reorderPlan,
  sectionOf,
  nextSortOrder,
} from './requirement-order';
import type { ComplianceRequirement, ComplianceSection } from '../../types';

const sec = (name: string, sortOrder: number, isBuiltIn = false): ComplianceSection =>
  ({ name, sortOrder, isBuiltIn });

const SECTIONS = [
  sec('General Requirements', 0, true),
  sec('Safety & Electrical', 1, true),
  sec('Packaging & Labeling', 2, true),
  sec('Aardvark Custom', 3),
];

const req = (
  over: Partial<ComplianceRequirement> & { id: string; title: string },
): ComplianceRequirement => ({
  categoryId: 'cat',
  assignedCategoryIds: [],
  description: '',
  isMandatory: false,
  appliesByDefault: true,
  sortOrder: 0,
  ...over,
});

describe('sectionOf', () => {
  it('falls back to the default for a missing or blank section', () => {
    expect(sectionOf(req({ id: 'a', title: 'A' }))).toBe(DEFAULT_SECTION_NAME);
    expect(sectionOf(req({ id: 'a', title: 'A', section: '   ' }))).toBe(DEFAULT_SECTION_NAME);
  });

  it('trims, so " Safety " and "Safety" are one section', () => {
    expect(sectionOf(req({ id: 'a', title: 'A', section: '  Safety & Electrical  ' })))
      .toBe('Safety & Electrical');
  });
});

describe('orderSectionNames — the operator decides', () => {
  it('orders by sort_order, not alphabetically and not by built-in-ness', () => {
    // "Aardvark Custom" sorts LAST despite being alphabetically first and custom. That is the
    // whole point: previously three screens sorted custom sections alphabetically after the
    // built-ins, and the library sorted them by creation date.
    expect(orderSectionNames(
      ['Aardvark Custom', 'Packaging & Labeling', 'General Requirements'],
      SECTIONS,
    )).toEqual(['General Requirements', 'Packaging & Labeling', 'Aardvark Custom']);
  });

  it('lets a custom section be placed ABOVE a built-in one', () => {
    const reordered = [sec('Custom First', 0), sec('General Requirements', 1, true)];
    expect(orderSectionNames(['General Requirements', 'Custom First'], reordered))
      .toEqual(['Custom First', 'General Requirements']);
  });

  it('puts an unknown section last, and orders several of them deterministically', () => {
    expect(orderSectionNames(
      ['Zebra Legacy', 'Safety & Electrical', 'Alpha Legacy'],
      SECTIONS,
    )).toEqual(['Safety & Electrical', 'Alpha Legacy', 'Zebra Legacy']);
  });

  it('de-duplicates', () => {
    expect(orderSectionNames(
      ['Safety & Electrical', 'Safety & Electrical'],
      SECTIONS,
    )).toEqual(['Safety & Electrical']);
  });

  it('breaks a sort_order tie on the name, so the result is never unstable', () => {
    const tied = [sec('Bravo', 5), sec('Alpha', 5)];
    expect(orderSectionNames(['Bravo', 'Alpha'], tied)).toEqual(['Alpha', 'Bravo']);
  });
});

describe('orderRequirements', () => {
  it('orders by sortOrder', () => {
    const list = [
      req({ id: 'c', title: 'C', sortOrder: 2 }),
      req({ id: 'a', title: 'A', sortOrder: 0 }),
      req({ id: 'b', title: 'B', sortOrder: 1 }),
    ];
    expect(orderRequirements(list).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does NOT fall back to alphabetical when an order is defined', () => {
    // Zebra first is a legitimate arrangement and must survive.
    const list = [
      req({ id: 'a', title: 'Alpha', sortOrder: 1 }),
      req({ id: 'z', title: 'Zebra', sortOrder: 0 }),
    ];
    expect(orderRequirements(list).map(r => r.id)).toEqual(['z', 'a']);
  });

  it('breaks a tie on title, so an un-ordered list is still deterministic', () => {
    const list = [
      req({ id: 'b', title: 'Bravo' }),
      req({ id: 'a', title: 'Alpha' }),
    ];
    expect(orderRequirements(list).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('treats a missing sortOrder as 0 rather than throwing', () => {
    const legacy = { id: 'x', title: 'X' } as ComplianceRequirement;
    expect(orderRequirements([req({ id: 'a', title: 'A', sortOrder: 1 }), legacy]).map(r => r.id))
      .toEqual(['x', 'a']);
  });

  it('does not mutate its input', () => {
    const list = [req({ id: 'b', title: 'B', sortOrder: 1 }), req({ id: 'a', title: 'A', sortOrder: 0 })];
    orderRequirements(list);
    expect(list.map(r => r.id)).toEqual(['b', 'a']);
  });

  it('mandatoryFirst OUTRANKS the defined order — it answers a different question', () => {
    const list = [
      req({ id: 'opt', title: 'Optional', sortOrder: 0, isMandatory: false }),
      req({ id: 'must', title: 'Mandatory', sortOrder: 1, isMandatory: true }),
    ];
    expect(orderRequirements(list, { mandatoryFirst: true }).map(r => r.id)).toEqual(['must', 'opt']);
    // …and the defined order still governs within each band.
    expect(orderRequirements(list).map(r => r.id)).toEqual(['opt', 'must']);
  });
});

describe('groupRequirementsBySection', () => {
  const REQS = [
    req({ id: 'pack', title: 'Artwork', section: 'Packaging & Labeling', sortOrder: 0 }),
    req({ id: 'safe2', title: 'EMC', section: 'Safety & Electrical', sortOrder: 1 }),
    req({ id: 'safe1', title: 'LVD', section: 'Safety & Electrical', sortOrder: 0 }),
    req({ id: 'none', title: 'Unfiled', sortOrder: 0 }),
  ];

  it('orders the sections and the requirements inside them', () => {
    expect(groupRequirementsBySection(REQS, SECTIONS).map(g => ({
      section: g.section,
      ids: g.requirements.map(r => r.id),
    }))).toEqual([
      { section: 'General Requirements', ids: ['none'] },
      { section: 'Safety & Electrical', ids: ['safe1', 'safe2'] },
      { section: 'Packaging & Labeling', ids: ['pack'] },
    ]);
  });

  it('omits empty sections by default — a supplier learns nothing from a blank heading', () => {
    expect(groupRequirementsBySection(REQS, SECTIONS).map(g => g.section))
      .not.toContain('Aardvark Custom');
  });

  it('includes them for the library, where an empty group is where you file the next thing', () => {
    const groups = groupRequirementsBySection(REQS, SECTIONS, { includeEmptySections: true });
    expect(groups.map(g => g.section)).toEqual([
      'General Requirements', 'Safety & Electrical', 'Packaging & Labeling', 'Aardvark Custom',
    ]);
    expect(groups.find(g => g.section === 'Aardvark Custom')!.requirements).toEqual([]);
  });

  it('NEVER drops a requirement whose section row was deleted', () => {
    // A requirement nobody can find is worse than an untidy heading.
    const stale = req({ id: 'stale', title: 'Stale', section: 'Deleted Section' });
    const groups = groupRequirementsBySection([...REQS, stale], SECTIONS);
    const group = groups.find(g => g.section === 'Deleted Section');
    expect(group).toBeDefined();
    expect(group!.isKnownSection).toBe(false);
    expect(group!.requirements.map(r => r.id)).toEqual(['stale']);
    // …and it sorts after every known section.
    expect(groups[groups.length - 1].section).toBe('Deleted Section');
  });

  it('marks known sections as known', () => {
    expect(groupRequirementsBySection(REQS, SECTIONS).every(g => g.isKnownSection)).toBe(true);
  });

  it('passes mandatoryFirst down into each section', () => {
    const list = [
      req({ id: 'opt', title: 'Opt', section: 'Safety & Electrical', sortOrder: 0 }),
      req({ id: 'must', title: 'Must', section: 'Safety & Electrical', sortOrder: 1, isMandatory: true }),
    ];
    expect(groupRequirementsBySection(list, SECTIONS, { mandatoryFirst: true })[0].requirements.map(r => r.id))
      .toEqual(['must', 'opt']);
  });

  it('handles an empty requirement list without inventing groups', () => {
    expect(groupRequirementsBySection([], SECTIONS)).toEqual([]);
  });
});

describe('reorderPlan — writes only what moved', () => {
  const current = [
    { id: 'a', sortOrder: 0 },
    { id: 'b', sortOrder: 1 },
    { id: 'c', sortOrder: 2 },
  ];

  it('returns nothing when the order is unchanged', () => {
    expect(reorderPlan(['a', 'b', 'c'], current)).toEqual([]);
  });

  it('returns only the rows whose number changes', () => {
    // Swapping the first two must not rewrite 'c'. Every extra write is one the FINAL-lock
    // guard has to check and the history trigger has to consider.
    expect(reorderPlan(['b', 'a', 'c'], current)).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
  });

  it('numbers from 0, contiguously, so a later append is just max + 1', () => {
    expect(reorderPlan(['c', 'b', 'a'], current)).toEqual([
      { id: 'c', sortOrder: 0 },
      { id: 'a', sortOrder: 2 },
    ]);
  });

  it('treats a missing sortOrder as 0, so moving such a row to the top writes nothing for it', () => {
    // `x` has no number, which reads as 0 everywhere (here and in orderRequirements), so
    // putting it first is already true of the stored data — only `a` has to move.
    expect(reorderPlan(['x', 'a'], [{ id: 'a', sortOrder: 0 }, { id: 'x' }]))
      .toEqual([{ id: 'a', sortOrder: 1 }]);
  });

  it('does number a row that had none when its target is not 0', () => {
    expect(reorderPlan(['a', 'x'], [{ id: 'a', sortOrder: 0 }, { id: 'x' }]))
      .toEqual([{ id: 'x', sortOrder: 1 }]);
  });
});

describe('moveInList', () => {
  it('moves an item down', () => {
    expect(moveInList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('moves an item up', () => {
    expect(moveInList(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op for the same index, and never mutates', () => {
    const list = ['a', 'b', 'c'];
    expect(moveInList(list, 1, 1)).toEqual(['a', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('ignores out-of-range indices instead of corrupting the list', () => {
    // The arrow buttons compute index ± 1 and are disabled at the ends; this is the belt.
    expect(moveInList(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveInList(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

describe('nextSortOrder — a new requirement appends', () => {
  const LIB = [
    req({ id: 'a', title: 'A', section: 'Safety & Electrical', sortOrder: 0 }),
    req({ id: 'b', title: 'B', section: 'Safety & Electrical', sortOrder: 1 }),
    req({ id: 'g', title: 'G', section: 'Safety & Electrical', sortOrder: 7, categoryId: null }),
    req({ id: 'other', title: 'O', section: 'Packaging & Labeling', sortOrder: 4 }),
  ];

  it('returns one past the last position in that section', () => {
    expect(nextSortOrder(LIB, 'cat', 'Safety & Electrical')).toBe(2);
  });

  it('starts at 0 in an empty section', () => {
    expect(nextSortOrder(LIB, 'cat', 'Chemical & Material')).toBe(0);
  });

  it('numbers a global among the OTHER globals, not among a category own rows', () => {
    // This is the bug it fixes: three globals all landed on 0 because the default was 0.
    expect(nextSortOrder(LIB, null, 'Safety & Electrical')).toBe(8);
  });

  it('does not count another section peers', () => {
    expect(nextSortOrder(LIB, 'cat', 'Packaging & Labeling')).toBe(5);
  });

  it('treats a blank section as the default one', () => {
    const unfiled = [req({ id: 'u', title: 'U', sortOrder: 3 })];
    expect(nextSortOrder(unfiled, 'cat', '   ')).toBe(4);
    expect(nextSortOrder(unfiled, 'cat', undefined)).toBe(4);
  });
});
