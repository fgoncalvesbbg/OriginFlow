import { describe, it, expect } from 'vitest';
import { planRequirementSharing, summarizeSharingPlan } from './requirement-sharing-plan';
import type { CategoryL3, ComplianceRequirement } from '../../types';

const cat = (id: string, name: string, over: Partial<CategoryL3> = {}): CategoryL3 => ({
  id, name, active: true, isFinalized: false, ...over,
});

const req = (over: Partial<ComplianceRequirement> & { id: string; title: string }): ComplianceRequirement => ({
  categoryId: 'angled',
  assignedCategoryIds: [],
  description: '',
  isMandatory: true,
  appliesByDefault: true,
  ...over,
});

const ANGLED  = cat('angled', 'Angled Hoods');
const CEILING = cat('ceiling', 'Ceiling Hoods');
const ISLAND  = cat('island', 'Island Hoods');
const LOCKED  = cat('locked', 'Wall Hoods', { isFinalized: true });
const CATEGORIES = [ANGLED, CEILING, ISLAND, LOCKED];

const LVD = req({ id: 'lvd', title: 'LVD Report' });

describe('planRequirementSharing — LINK', () => {
  it('adds the targets to the requirement it already has, keeping existing shares', () => {
    const shared = req({ id: 'lvd', title: 'LVD Report', assignedCategoryIds: ['island'] });
    const plan = planRequirementSharing({
      requirements: [shared], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'link',
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0].addCategoryIds).toEqual(['ceiling']);
    // Island must survive: writing only the new target would silently unshare it.
    expect(plan.links[0].nextAssignedIds).toEqual(['ceiling', 'island']);
    expect(plan.copies).toHaveLength(0);
  });

  it('writes the link list sorted, so re-applying the same set is a no-op in the history', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['island', 'ceiling'], mode: 'link',
    });
    expect(plan.links[0].nextAssignedIds).toEqual(['ceiling', 'island']);
  });

  it('skips the requirement’s own home category', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['angled'], mode: 'link',
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.skips).toEqual([
      { title: 'LVD Report', targetCategoryName: 'Angled Hoods', reason: 'home' },
    ]);
  });

  it('skips a category it already reaches', () => {
    const shared = req({ id: 'lvd', title: 'LVD Report', assignedCategoryIds: ['ceiling'] });
    const plan = planRequirementSharing({
      requirements: [shared], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'link',
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.skips[0].reason).toBe('already-applies');
  });

  it('refuses to share a GLOBAL requirement, which already applies everywhere', () => {
    const global = req({ id: 'art', title: 'Packaging artwork', categoryId: null });
    const plan = planRequirementSharing({
      requirements: [global], categories: CATEGORIES,
      requirementIds: ['art'], targetCategoryIds: ['ceiling', 'island'], mode: 'link',
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.skips.map(s => s.reason)).toEqual(['global', 'global']);
  });
});

describe('planRequirementSharing — the FINAL lock', () => {
  it('blocks a FINAL target and says which side is locked', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['locked', 'ceiling'], mode: 'link',
    });
    expect(plan.blocks).toEqual([
      { categoryName: 'Wall Hoods', side: 'target', titles: ['LVD Report'] },
    ]);
    // The unlocked target still goes ahead — one locked category must not veto the rest.
    expect(plan.links[0].addCategoryIds).toEqual(['ceiling']);
  });

  it('blocks the whole LINK when the requirement already reaches a FINAL category', () => {
    // The row cannot be written at all — the guard refuses any update to it — so adding an
    // unrelated category is impossible, not partially possible.
    const shared = req({ id: 'lvd', title: 'LVD Report', assignedCategoryIds: ['locked'] });
    const plan = planRequirementSharing({
      requirements: [shared], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'link',
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.blocks).toEqual([
      { categoryName: 'Wall Hoods', side: 'source', titles: ['LVD Report'] },
    ]);
  });

  it('blocks when the requirement’s OWN home is FINAL', () => {
    const homeLocked = req({ id: 'lvd', title: 'LVD Report', categoryId: 'locked' });
    const plan = planRequirementSharing({
      requirements: [homeLocked], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'link',
    });
    expect(plan.blocks[0].side).toBe('source');
  });

  it('does NOT block a COPY on a locked source — a copy never touches the source row', () => {
    const shared = req({ id: 'lvd', title: 'LVD Report', assignedCategoryIds: ['locked'] });
    const plan = planRequirementSharing({
      requirements: [shared], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
    });
    expect(plan.blocks).toHaveLength(0);
    expect(plan.copies).toHaveLength(1);
  });

  it('still blocks a FINAL target for a COPY — its set is frozen either way', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['locked'], mode: 'copy',
    });
    expect(plan.copies).toHaveLength(0);
    expect(plan.blocks[0].side).toBe('target');
  });

  it('collects every title one locked category stops, rather than one block per title', () => {
    const a = req({ id: 'a', title: 'LVD Report' });
    const b = req({ id: 'b', title: 'EMC Report' });
    const plan = planRequirementSharing({
      requirements: [a, b], categories: CATEGORIES,
      requirementIds: ['a', 'b'], targetCategoryIds: ['locked'], mode: 'link',
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].titles.sort()).toEqual(['EMC Report', 'LVD Report']);
  });
});

describe('planRequirementSharing — COPY', () => {
  it('plans one new row per target', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling', 'island'], mode: 'copy',
    });
    expect(plan.copies.map(c => c.targetCategoryId)).toEqual(['ceiling', 'island']);
    expect(plan.links).toHaveLength(0);
  });

  it('will not duplicate a title the target already has', () => {
    const existing = req({ id: 'other', title: 'lvd  REPORT', categoryId: 'ceiling' });
    const plan = planRequirementSharing({
      requirements: [LVD, existing], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
    });
    expect(plan.copies).toHaveLength(0);
    expect(plan.skips[0].reason).toBe('same-title');
  });

  it('will not copy where the requirement already applies by a link', () => {
    const shared = req({ id: 'lvd', title: 'LVD Report', assignedCategoryIds: ['ceiling'] });
    const plan = planRequirementSharing({
      requirements: [shared], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
    });
    expect(plan.copies).toHaveLength(0);
    expect(plan.skips[0].reason).toBe('already-applies');
  });
});

describe('planRequirementSharing — robustness', () => {
  it('ignores unknown requirement and category ids instead of planning against nothing', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd', 'ghost'], targetCategoryIds: ['ceiling', 'ghost-cat'], mode: 'link',
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0].addCategoryIds).toEqual(['ceiling']);
  });

  it('is a no-op with no targets selected, so the dialog can disable its button', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: [], mode: 'link',
    });
    expect(plan.isNoop).toBe(true);
  });
});

describe('summarizeSharingPlan', () => {
  it('counts distinct categories gained, not link operations', () => {
    const a = req({ id: 'a', title: 'LVD Report' });
    const b = req({ id: 'b', title: 'EMC Report' });
    const plan = planRequirementSharing({
      requirements: [a, b], categories: CATEGORIES,
      requirementIds: ['a', 'b'], targetCategoryIds: ['ceiling', 'island'], mode: 'link',
    });
    // Two requirements each gaining the same two categories is two categories, not four.
    expect(summarizeSharingPlan(plan)).toMatchObject({
      linkedRequirements: 2,
      linkedCategories: 2,
      copies: 0,
    });
  });

  it('counts what a locked category blocked', () => {
    const plan = planRequirementSharing({
      requirements: [LVD], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['locked'], mode: 'link',
    });
    expect(summarizeSharingPlan(plan).blocked).toBe(1);
  });
});

// ── Pooling: the same planner, pointed inward at one category and one section ──────────────
describe('planRequirementSharing — pooling into a target SECTION', () => {
  const SOURCE = req({
    id: 'lvd', title: 'LVD Report', categoryId: 'angled', section: 'Electrical Test Reports',
  });

  it('files a COPY under the requested section, not the source’s', () => {
    const plan = planRequirementSharing({
      requirements: [SOURCE], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
      targetSection: 'Safety & Electrical',
    });
    expect(plan.copies).toHaveLength(1);
    expect(plan.copies[0].section).toBe('Safety & Electrical');
  });

  it('reports where a LINK will actually appear — it cannot be re-sectioned', () => {
    // One row, one `section`. The dialog needs this to warn instead of silently filing the
    // requirement under a heading the operator did not click.
    const plan = planRequirementSharing({
      requirements: [SOURCE], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'link',
      targetSection: 'Safety & Electrical',
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0].landsInSection).toBe('Electrical Test Reports');
  });

  it('keeps the source’s section on a copy when no target section is given', () => {
    // The outward "apply to categories" dialog passes none — each requirement keeps its own.
    const plan = planRequirementSharing({
      requirements: [SOURCE], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
    });
    expect(plan.copies[0].section).toBe('Electrical Test Reports');
  });

  it('resolves a source with no section to the default, both for links and copies', () => {
    const unfiled = req({ id: 'u', title: 'Unfiled', categoryId: 'angled' });
    const linked = planRequirementSharing({
      requirements: [unfiled], categories: CATEGORIES,
      requirementIds: ['u'], targetCategoryIds: ['ceiling'], mode: 'link',
    });
    expect(linked.links[0].landsInSection).toBe('General Requirements');
    const copied = planRequirementSharing({
      requirements: [unfiled], categories: CATEGORIES,
      requirementIds: ['u'], targetCategoryIds: ['ceiling'], mode: 'copy',
    });
    expect(copied.copies[0].section).toBe('General Requirements');
  });

  it('ignores a blank target section rather than filing under an empty heading', () => {
    const plan = planRequirementSharing({
      requirements: [SOURCE], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['ceiling'], mode: 'copy',
      targetSection: '   ',
    });
    expect(plan.copies[0].section).toBe('Electrical Test Reports');
  });

  it('pools a GLOBAL requirement nowhere — it already applies to the target', () => {
    const global = req({ id: 'g', title: 'BOM', categoryId: null });
    const plan = planRequirementSharing({
      requirements: [global], categories: CATEGORIES,
      requirementIds: ['g'], targetCategoryIds: ['ceiling'], mode: 'link',
      targetSection: 'Safety & Electrical',
    });
    expect(plan.isNoop).toBe(true);
    expect(plan.skips[0].reason).toBe('global');
  });

  it('still refuses to pool into a FINAL category', () => {
    const plan = planRequirementSharing({
      requirements: [SOURCE], categories: CATEGORIES,
      requirementIds: ['lvd'], targetCategoryIds: ['locked'], mode: 'copy',
      targetSection: 'Safety & Electrical',
    });
    expect(plan.copies).toHaveLength(0);
    expect(plan.blocks[0]).toMatchObject({ categoryName: 'Wall Hoods', side: 'target' });
  });
});
