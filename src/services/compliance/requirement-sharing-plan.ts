/**
 * What "apply these requirements to these categories" will actually do — decided BEFORE
 * anything is written (migration 173).
 *
 * Pure, and separated from the service that executes it, for the same reason
 * `attribute-sync-plan.ts` is: the operator is about to fan one decision out across a dozen
 * categories, and the only honest way to ask for confirmation is to show the consequence
 * item by item. A dialog that says "Apply?" and then reports "9 of 24 done" has already lost
 * their trust, and there is no undo for the fifteen it skipped.
 *
 * The planner is also where every rule that makes an item a no-op lives, in one readable
 * list, rather than scattered through a loop that is half write and half validation.
 *
 *   LINK  one row gains the target categories in `assignedCategoryIds`. Edit it once
 *         afterwards and every listed category sees the change. This is what "all Hoods have
 *         the same requirements" means if they are to STAY the same.
 *
 *   COPY  each target gets its own independent row. Free to diverge. Right when the
 *         categories merely start from the same place.
 */

import type { CategoryL3, ComplianceRequirement } from '../../types';
import { requirementAppliesToCategory } from '../../utils/requirement-scope.utils';
import { sectionOf } from './requirement-order';

export type SharingMode = 'link' | 'copy';

export type SharingSkipReason =
  /** The target is the requirement's own home category. */
  | 'home'
  /** The requirement is global — it already applies to every category, including this one. */
  | 'global'
  /** The target already gets this requirement (owned, global, or already linked). */
  | 'already-applies'
  /** COPY only: the target already has a requirement with this title. */
  | 'same-title';

export const SHARING_SKIP_LABELS: Record<SharingSkipReason, string> = {
  home: 'already its own category',
  global: 'global — already applies everywhere',
  'already-applies': 'already applies here',
  'same-title': 'a requirement with this title already exists here',
};

/** One requirement gaining one or more categories in its link list. */
export interface PlannedLink {
  requirementId: string;
  title: string;
  /** Categories being added now. Never includes ones it already reached. */
  addCategoryIds: string[];
  addCategoryNames: string[];
  /** The complete list to write, existing shares included. */
  nextAssignedIds: string[];
  /**
   * The section it will appear under. A LINK is one row with one `section`, so it keeps its
   * own wherever it is shown — it cannot be filed into a different section per category. When
   * that differs from a requested `targetSection` the dialog says so, because "add to this
   * section" and "it appeared under another heading" would otherwise look like a bug.
   */
  landsInSection: string;
}

/** One new independent row to create in one target category. */
export interface PlannedCopy {
  sourceRequirementId: string;
  title: string;
  targetCategoryId: string;
  targetCategoryName: string;
  /**
   * The section to file the copy under. A copy is a NEW row, so unlike a link it can be
   * re-sectioned freely — which is what makes COPY the mode that always honours
   * "add to this section".
   */
  section: string;
}

export interface PlannedSkip {
  title: string;
  targetCategoryName: string;
  reason: SharingSkipReason;
}

/** A category whose FINAL lock refuses the write (migration 172). */
export interface PlannedBlock {
  categoryName: string;
  /** `target` = the destination is locked. `source` = a requirement already reaches a locked category. */
  side: 'target' | 'source';
  /** Titles of the requirements this block stops. */
  titles: string[];
}

export interface SharingPlan {
  mode: SharingMode;
  links: PlannedLink[];
  copies: PlannedCopy[];
  skips: PlannedSkip[];
  blocks: PlannedBlock[];
  /** True when there is genuinely nothing to write — the dialog disables its button on this. */
  isNoop: boolean;
}

/**
 * Title comparison for duplicate protection. Collapses runs of whitespace as well as
 * trimming, so "LVD  Report" does not slip past the check and create a second copy of
 * something the category already has — a stray double space is a typo, not a distinct
 * requirement, and the operator would have no way to see the difference in the list.
 */
const norm = (s: string | null | undefined): string =>
  (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Decide the plan.
 *
 * `requirements` must be the FULL library, not just the selected rows: deciding whether a
 * target "already applies" requires seeing every requirement that reaches it, including the
 * globals and the ones it already has linked. Passing a subset would plan duplicate copies.
 */
export const planRequirementSharing = (opts: {
  requirements: readonly ComplianceRequirement[];
  categories: readonly CategoryL3[];
  /** The requirements to fan out. */
  requirementIds: readonly string[];
  /** The categories to fan them out to. */
  targetCategoryIds: readonly string[];
  mode: SharingMode;
  /**
   * The section the requirements should land in. Set when POOLING into one section (the
   * library's "add from existing"); left unset when fanning a category's own set outward,
   * where each requirement keeps the section it already has.
   *
   * A COPY is filed here. A LINK cannot be — see `PlannedLink.landsInSection`.
   */
  targetSection?: string;
}): SharingPlan => {
  const { requirements, categories, requirementIds, targetCategoryIds, mode, targetSection } = opts;

  const categoryById = new Map(categories.map(c => [c.id, c]));
  const selected = requirementIds
    .map(id => requirements.find(r => r.id === id))
    .filter((r): r is ComplianceRequirement => !!r);

  const links: PlannedLink[] = [];
  const copies: PlannedCopy[] = [];
  const skips: PlannedSkip[] = [];
  /** Keyed by "side:categoryId" so one locked category collects all the titles it stops. */
  const blocks = new Map<string, PlannedBlock>();

  const block = (category: CategoryL3, side: PlannedBlock['side'], title: string) => {
    const key = `${side}:${category.id}`;
    const existing = blocks.get(key);
    if (existing) {
      if (!existing.titles.includes(title)) existing.titles.push(title);
      return;
    }
    blocks.set(key, { categoryName: category.name, side, titles: [title] });
  };

  for (const req of selected) {
    const title = req.title || 'Untitled requirement';

    // A global requirement already applies to every category. Sharing it would either be a
    // no-op (link) or twelve duplicates of something universal (copy).
    if (req.categoryId === null) {
      for (const targetId of targetCategoryIds) {
        const target = categoryById.get(targetId);
        if (target) skips.push({ title, targetCategoryName: target.name, reason: 'global' });
      }
      continue;
    }

    /**
     * The lock follows the link (migration 173): if the requirement ALREADY reaches a FINAL
     * category, any write to the row is refused — including one that only adds an unrelated
     * category. So this is checked once per requirement, against its whole current reach,
     * and it stops the whole item rather than one target of it.
     *
     * Only relevant to LINK. A copy writes new rows and never touches the source.
     */
    if (mode === 'link') {
      const reach = [req.categoryId, ...(req.assignedCategoryIds ?? [])];
      const lockedSource = reach
        .map(id => categoryById.get(id))
        .find((c): c is CategoryL3 => !!c && !!c.isFinalized);
      if (lockedSource) {
        block(lockedSource, 'source', title);
        continue;
      }
    }

    const nextAssigned = [...(req.assignedCategoryIds ?? [])];
    const addIds: string[] = [];
    const addNames: string[] = [];

    for (const targetId of targetCategoryIds) {
      const target = categoryById.get(targetId);
      if (!target) continue;

      if (targetId === req.categoryId) {
        skips.push({ title, targetCategoryName: target.name, reason: 'home' });
        continue;
      }

      // A FINAL target cannot gain a requirement, by either route — its set is frozen.
      if (target.isFinalized) {
        block(target, 'target', title);
        continue;
      }

      if (mode === 'link') {
        if (requirementAppliesToCategory(req, targetId)) {
          skips.push({ title, targetCategoryName: target.name, reason: 'already-applies' });
          continue;
        }
        addIds.push(targetId);
        addNames.push(target.name);
        nextAssigned.push(targetId);
        continue;
      }

      // COPY. Two different "already there" cases, and they are worth telling apart in the
      // dialog: the requirement already reaches the target by some route, or the target
      // separately happens to have one by the same name. Either way, no duplicate.
      if (requirementAppliesToCategory(req, targetId)) {
        skips.push({ title, targetCategoryName: target.name, reason: 'already-applies' });
        continue;
      }
      const clash = requirements.some(
        other => other.categoryId === targetId && norm(other.title) === norm(req.title),
      );
      if (clash) {
        skips.push({ title, targetCategoryName: target.name, reason: 'same-title' });
        continue;
      }
      copies.push({
        sourceRequirementId: req.id,
        title,
        targetCategoryId: targetId,
        targetCategoryName: target.name,
        section: targetSection?.trim() || sectionOf(req),
      });
    }

    if (addIds.length) {
      links.push({
        requirementId: req.id,
        title,
        addCategoryIds: addIds,
        addCategoryNames: addNames,
        landsInSection: sectionOf(req),
        // Sorted so the stored array has one canonical order and a re-save of an unchanged
        // set produces no history row (the trigger skips a no-op update).
        nextAssignedIds: [...new Set(nextAssigned)].sort(),
      });
    }
  }

  return {
    mode,
    links,
    copies,
    skips,
    blocks: [...blocks.values()],
    isNoop: links.length === 0 && copies.length === 0,
  };
};

/** Counts for the dialog's one-line summary. */
export const summarizeSharingPlan = (plan: SharingPlan) => ({
  /** Categories that will start seeing a shared requirement. */
  linkedCategories: new Set(plan.links.flatMap(l => l.addCategoryIds)).size,
  linkedRequirements: plan.links.length,
  copies: plan.copies.length,
  skipped: plan.skips.length,
  blocked: plan.blocks.reduce((n, b) => n + b.titles.length, 0),
});
