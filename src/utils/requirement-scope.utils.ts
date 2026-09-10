/**
 * Which TCF requirements reach a category — the ONE place that rule lives.
 *
 * There are three scopes and they compose (migration 173), and one subtractive exception
 * (migration 176):
 *
 *   OWNED    `categoryId === X`                    the category's own requirement.
 *   GLOBAL   `categoryId === null`                 applies to every category…
 *   EXCLUDED `excludedCategoryIds` contains X      …except the ones listed here. "This
 *                                                  category has no electronics, so it never
 *                                                  needs an electrical safety report."
 *   LINKED   `assignedCategoryIds` contains X      one row shared with several categories,
 *                                                  e.g. every Hood asking for the same LVD
 *                                                  report. Edited once, changes everywhere.
 *
 * EXCLUSION WINS over everything else. It is checked first and it is absolute — otherwise
 * "global, except here" would depend on the order the scopes happen to be evaluated in, which
 * is not a property a compliance rule may have.
 *
 * This is deliberately the same rule, in the same order, as `getAttributesForCategory` in
 * attribute-validation.utils.ts. Requirements and attributes now share one notion of scope,
 * so an operator who understands "shared attribute" already understands "shared requirement".
 *
 * WHY A SHARED HELPER AND NOT SIX INLINE FILTERS. The predicate was written out by hand in
 * six places — the library's index count, its category view, the request builder's condition
 * gate, its expired-regulation check, the internal request detail, and the SUPPLIER PORTAL.
 * A linked requirement that the portal did not resolve would be a requirement the supplier is
 * never asked for, which is the failure mode that matters here: silent, and invisible until
 * an audit. One function means a new scope cannot reach five of the six.
 */

import type { ComplianceRequirement } from '../types';

/** Whether one requirement applies to one category. Exclusion first, then the three scopes. */
export const requirementAppliesToCategory = (
  req: Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds' | 'excludedCategoryIds'>,
  categoryId: string,
): boolean => {
  if ((req.excludedCategoryIds ?? []).includes(categoryId)) return false;
  return (
    req.categoryId === categoryId ||
    req.categoryId === null ||
    (req.assignedCategoryIds ?? []).includes(categoryId)
  );
};

/**
 * Requirements that WOULD reach this category but are marked not applicable to it.
 *
 * The library needs these: once excluded, a requirement vanishes from the category's list,
 * and a state you cannot see is a state you cannot undo. Every other surface — the request
 * builder, the supplier portal — must NOT show them, which is why this is a separate function
 * rather than a flag on the main one.
 */
export const getExcludedRequirementsForCategory = <
  T extends Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds' | 'excludedCategoryIds'>,
>(
  all: readonly T[],
  categoryId: string,
): T[] => all.filter(r => (r.excludedCategoryIds ?? []).includes(categoryId));

/**
 * The FINAL categories an edit to this requirement will reach (migration 177).
 *
 * Since 177 the lock freezes a locked category's MEMBERSHIP, not the wording of the
 * requirements in it — so a content edit is allowed however many FINAL categories hold it.
 * That makes this list a WARNING rather than a block: the operator is told whose signed-off
 * set they are about to reword, and decides.
 *
 * A global requirement reaches every category, so every FINAL one is listed except those it
 * is explicitly not applicable to. Ordered by name so the warning reads the same every time.
 */
export const finalCategoriesForRequirement = <
  C extends { id: string; name: string; isFinalized?: boolean },
>(
  req: Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds' | 'excludedCategoryIds'>,
  categories: readonly C[],
): C[] =>
  categories
    .filter(c => c.isFinalized && requirementAppliesToCategory(req, c.id))
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * How many categories a global requirement is excluded from. 0 for anything not global,
 * where exclusions are not a valid state at all (migration 176).
 */
export const requirementExclusionCount = (
  req: Pick<ComplianceRequirement, 'categoryId' | 'excludedCategoryIds'>,
): number => (req.categoryId === null ? (req.excludedCategoryIds ?? []).length : 0);

/**
 * Every requirement that reaches a category, in a stable, meaningful order: globals first,
 * then the category's own and the ones shared with it.
 *
 * Globals lead because that is the order the library, the internal request detail and the
 * supplier portal already show them in, and a supplier reading a request should meet the
 * universal asks before the category-specific ones. Within each band the incoming order is
 * preserved, so whatever `getComplianceRequirements` returned still governs.
 */
export const getRequirementsForCategory = <
  T extends Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds' | 'excludedCategoryIds'>,
>(
  all: readonly T[],
  categoryId: string,
): T[] => {
  // Filter FIRST, then band. An earlier version banded first and let the globals branch
  // through unfiltered — which was fine while globals applied unconditionally, and became a
  // hole the moment exclusions existed (migration 176): an excluded requirement would still
  // have reached the supplier portal. Every row goes through the predicate exactly once.
  const applies = all.filter(r => requirementAppliesToCategory(r, categoryId));
  return [
    ...applies.filter(r => r.categoryId === null),
    ...applies.filter(r => r.categoryId !== null),
  ];
};

/**
 * The requirements a category's FINAL lock freezes (migration 172 + 173).
 *
 * NOT the same set as `getRequirementsForCategory`: globals are excluded, because no
 * category's lock reaches them, and linked ones ARE included, because the lock guard refuses
 * to let them change while this category is FINAL. Used for every count the lock UI quotes —
 * a banner that says "12 requirements frozen" must mean the twelve that are actually frozen.
 */
export const getRequirementsFrozenByCategory = <T extends Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds'>>(
  all: readonly T[],
  categoryId: string,
): T[] => all.filter(r => r.categoryId !== null && requirementAppliesToCategory(r, categoryId));

/**
 * How many categories one requirement serves, counting its home. 1 = not shared.
 *
 * Returns 0 for a global requirement rather than a count: "shared with N categories" is the
 * wrong sentence for something that applies to all of them, and the caller should say
 * "Global" instead. Callers therefore treat 0 as "not applicable", never as "none".
 */
export const requirementShareCount = (
  req: Pick<ComplianceRequirement, 'categoryId' | 'assignedCategoryIds'>,
): number => (req.categoryId === null ? 0 : 1 + (req.assignedCategoryIds ?? []).length);
