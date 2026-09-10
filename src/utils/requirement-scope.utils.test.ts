import { describe, it, expect } from 'vitest';
import {
  getRequirementsForCategory,
  getRequirementsFrozenByCategory,
  requirementAppliesToCategory,
  requirementShareCount,
  getExcludedRequirementsForCategory,
  requirementExclusionCount,
  finalCategoriesForRequirement,
} from './requirement-scope.utils';
import type { ComplianceRequirement } from '../types';

const req = (over: Partial<ComplianceRequirement> & { id: string }): ComplianceRequirement => ({
  categoryId: 'angled',
  assignedCategoryIds: [],
  title: over.id,
  description: '',
  isMandatory: true,
  appliesByDefault: true,
  ...over,
});

const OWNED    = req({ id: 'owned' });
const GLOBAL   = req({ id: 'global', categoryId: null });
const SHARED   = req({ id: 'shared', categoryId: 'angled', assignedCategoryIds: ['ceiling', 'island'] });
const ELSEWHERE = req({ id: 'elsewhere', categoryId: 'kettles' });

describe('requirementAppliesToCategory — the one scope rule', () => {
  it('applies to the category that owns it', () => {
    expect(requirementAppliesToCategory(OWNED, 'angled')).toBe(true);
    expect(requirementAppliesToCategory(OWNED, 'ceiling')).toBe(false);
  });

  it('applies a global requirement to every category', () => {
    expect(requirementAppliesToCategory(GLOBAL, 'angled')).toBe(true);
    expect(requirementAppliesToCategory(GLOBAL, 'kettles')).toBe(true);
  });

  it('applies a linked requirement to every category it is shared with', () => {
    expect(requirementAppliesToCategory(SHARED, 'angled')).toBe(true);   // its home
    expect(requirementAppliesToCategory(SHARED, 'ceiling')).toBe(true);  // shared
    expect(requirementAppliesToCategory(SHARED, 'island')).toBe(true);   // shared
    expect(requirementAppliesToCategory(SHARED, 'kettles')).toBe(false);
  });

  it('treats a missing link list as empty rather than throwing', () => {
    // Rows read before migration 173 have no array at all.
    const legacy = { categoryId: 'angled' } as ComplianceRequirement;
    expect(requirementAppliesToCategory(legacy, 'angled')).toBe(true);
    expect(requirementAppliesToCategory(legacy, 'ceiling')).toBe(false);
  });
});

describe('getRequirementsForCategory', () => {
  const all = [OWNED, GLOBAL, SHARED, ELSEWHERE];

  it('returns owned, global and shared-in — and nothing else', () => {
    expect(getRequirementsForCategory(all, 'angled').map(r => r.id).sort())
      .toEqual(['global', 'owned', 'shared']);
  });

  it('resolves a shared requirement into a category that does not own it', () => {
    // This is the case the supplier portal must get right: Ceiling Hoods owns nothing here,
    // yet must still be asked for the shared requirement.
    expect(getRequirementsForCategory(all, 'ceiling').map(r => r.id))
      .toEqual(['global', 'shared']);
  });

  it('puts globals first', () => {
    expect(getRequirementsForCategory(all, 'angled')[0].id).toBe('global');
  });

  it('lists each requirement once, even when it is both owned and shared elsewhere', () => {
    const ids = getRequirementsForCategory(all, 'angled').map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getRequirementsFrozenByCategory — what a FINAL lock actually freezes', () => {
  const all = [OWNED, GLOBAL, SHARED, ELSEWHERE];

  it('excludes globals: no category lock reaches them', () => {
    expect(getRequirementsFrozenByCategory(all, 'angled').map(r => r.id).sort())
      .toEqual(['owned', 'shared']);
  });

  it('includes a shared requirement in a category that does not own it', () => {
    // Locking Ceiling Hoods freezes the shared requirement even though Angled Hoods owns it —
    // which is exactly why the guard checks the whole link list.
    expect(getRequirementsFrozenByCategory(all, 'ceiling').map(r => r.id)).toEqual(['shared']);
  });
});

describe('requirementShareCount', () => {
  it('counts the home category, so 1 means unshared', () => {
    expect(requirementShareCount(OWNED)).toBe(1);
  });

  it('counts home plus every link', () => {
    expect(requirementShareCount(SHARED)).toBe(3);
  });

  it('returns 0 for a global requirement rather than a misleading count', () => {
    expect(requirementShareCount(GLOBAL)).toBe(0);
  });
});

// ── Exclusions: "global, except here" (migration 176) ─────────────────────────────────────
describe('exclusions beat every other scope', () => {
  const EXCLUDED_GLOBAL = req({
    id: 'lvd', title: 'LVD Report', categoryId: null, excludedCategoryIds: ['ceiling'],
  });

  it('stops a global requirement applying to an excluded category', () => {
    expect(requirementAppliesToCategory(EXCLUDED_GLOBAL, 'angled')).toBe(true);
    expect(requirementAppliesToCategory(EXCLUDED_GLOBAL, 'ceiling')).toBe(false);
  });

  it('beats an explicit link, so the rule cannot depend on evaluation order', () => {
    // Not a state the canonicalise trigger permits, but the predicate must still be total:
    // an exclusion that could be overridden by another scope is not an exclusion.
    const contradictory = req({
      id: 'x', title: 'X', categoryId: 'angled',
      assignedCategoryIds: ['ceiling'], excludedCategoryIds: ['ceiling'],
    });
    expect(requirementAppliesToCategory(contradictory, 'ceiling')).toBe(false);
  });

  it('beats ownership too', () => {
    const contradictory = req({
      id: 'x', title: 'X', categoryId: 'angled', excludedCategoryIds: ['angled'],
    });
    expect(requirementAppliesToCategory(contradictory, 'angled')).toBe(false);
  });

  it('treats a missing exclusion list as empty rather than throwing', () => {
    const legacy = { categoryId: null } as ComplianceRequirement;
    expect(requirementAppliesToCategory(legacy, 'angled')).toBe(true);
  });

  it('removes it from what the category resolves to', () => {
    const all = [EXCLUDED_GLOBAL, OWNED];
    expect(getRequirementsForCategory(all, 'angled').map(r => r.id)).toEqual(['lvd', 'owned']);
    expect(getRequirementsForCategory(all, 'ceiling').map(r => r.id)).toEqual([]);
  });

  it('removes it from what a FINAL lock freezes — it is not part of that set any more', () => {
    expect(getRequirementsFrozenByCategory([EXCLUDED_GLOBAL], 'ceiling')).toEqual([]);
  });
});

describe('getExcludedRequirementsForCategory', () => {
  it('finds what the category is opted out of, so the library can offer a way back', () => {
    const excluded = req({ id: 'e', title: 'E', categoryId: null, excludedCategoryIds: ['ceiling'] });
    const all = [excluded, GLOBAL, OWNED];
    expect(getExcludedRequirementsForCategory(all, 'ceiling').map(r => r.id)).toEqual(['e']);
    expect(getExcludedRequirementsForCategory(all, 'angled')).toEqual([]);
  });

  it('never overlaps with what applies — the two lists partition cleanly', () => {
    const excluded = req({ id: 'e', title: 'E', categoryId: null, excludedCategoryIds: ['ceiling'] });
    const all = [excluded, GLOBAL, SHARED];
    const applies = getRequirementsForCategory(all, 'ceiling').map(r => r.id);
    const opted = getExcludedRequirementsForCategory(all, 'ceiling').map(r => r.id);
    expect(applies.filter(id => opted.includes(id))).toEqual([]);
  });
});

describe('requirementExclusionCount', () => {
  it('counts the exceptions on a global requirement', () => {
    expect(requirementExclusionCount(req({
      id: 'g', title: 'G', categoryId: null, excludedCategoryIds: ['a', 'b'],
    }))).toBe(2);
  });

  it('returns 0 for a category-owned requirement, where exclusions are not a valid state', () => {
    expect(requirementExclusionCount(req({
      id: 'o', title: 'O', categoryId: 'angled', excludedCategoryIds: ['ceiling'],
    }))).toBe(0);
  });
});

// ── The FINAL warning list (migration 177) ────────────────────────────────────────────────
describe('finalCategoriesForRequirement', () => {
  const cats = [
    { id: 'angled', name: 'Angled Hoods', isFinalized: true },
    { id: 'ceiling', name: 'Ceiling Hoods', isFinalized: false },
    { id: 'island', name: 'Island Hoods', isFinalized: true },
    { id: 'kettles', name: 'Kettles', isFinalized: true },
  ];

  it('lists the FINAL categories a shared requirement reaches, and no others', () => {
    expect(finalCategoriesForRequirement(SHARED, cats).map(c => c.name))
      .toEqual(['Angled Hoods', 'Island Hoods']);
  });

  it('lists every FINAL category for a global requirement', () => {
    expect(finalCategoriesForRequirement(GLOBAL, cats).map(c => c.name))
      .toEqual(['Angled Hoods', 'Island Hoods', 'Kettles']);
  });

  it('honours an exclusion — an excluded category is not affected by the edit', () => {
    const excluded = req({ id: 'g', categoryId: null, excludedCategoryIds: ['kettles'] });
    expect(finalCategoriesForRequirement(excluded, cats).map(c => c.name))
      .toEqual(['Angled Hoods', 'Island Hoods']);
  });

  it('returns nothing when no category it reaches is FINAL', () => {
    const local = req({ id: 'l', categoryId: 'ceiling' });
    expect(finalCategoriesForRequirement(local, cats)).toEqual([]);
  });

  it('sorts by name so the warning reads the same every time', () => {
    const shuffled = [cats[3], cats[0], cats[2]];
    expect(finalCategoriesForRequirement(GLOBAL, shuffled).map(c => c.name))
      .toEqual(['Angled Hoods', 'Island Hoods', 'Kettles']);
  });

  it('treats a category with no isFinalized flag as not final', () => {
    expect(finalCategoriesForRequirement(GLOBAL, [{ id: 'x', name: 'X' }])).toEqual([]);
  });
});
