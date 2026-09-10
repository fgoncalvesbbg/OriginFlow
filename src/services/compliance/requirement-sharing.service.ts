/**
 * Executing a sharing plan — link one requirement to more categories, or copy it into them
 * (migration 173).
 *
 * Every decision was already made by `planRequirementSharing`, which the dialog showed the
 * operator item by item. This module only writes, and it writes EXACTLY the plan it was
 * given: no re-deriving, no "while we're here" tidying. That is the property that makes the
 * confirmation meaningful — what was on screen is what happens.
 *
 * It does not degrade. A half-applied fan-out across a dozen categories is worse than a
 * failed one, because the operator cannot see which half without reading twelve screens, so
 * a failure is reported with the number that did land and the message the database gave.
 */

import { db, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { generateUUID } from '../../utils';
import type { ComplianceRequirement } from '../../types';
import { getComplianceRequirementsOrThrow, saveRequirement } from './compliance-requirement.service';
import type { SharingPlan } from './requirement-sharing-plan';

export interface ApplySharingResult {
  /** Requirements whose link list grew. */
  linked: number;
  /** Categories that gained a link (across all requirements). */
  linkedCategories: number;
  /** New independent rows created. */
  copied: number;
}

/**
 * Apply a plan.
 *
 * LINK is a single-column update per requirement, so the whole fan-out to twelve categories
 * is one write — which is the real argument for linking over copying, quite apart from
 * keeping the categories in step afterwards.
 *
 * COPY reads the source rows fresh rather than trusting anything the dialog held: the copy is
 * a snapshot, and a snapshot of stale state is the kind of bug nobody finds until a supplier
 * is asked the wrong question. The read is non-degrading for the same reason.
 */
export const applyRequirementSharing = async (plan: SharingPlan): Promise<ApplySharingResult> => {
    if (!isLive) throw new Error('Database not configured.');

    const result: ApplySharingResult = { linked: 0, linkedCategories: 0, copied: 0 };

    for (const link of plan.links) {
        await db.updateWhere(
            'compliance_requirements',
            { assigned_category_ids: link.nextAssignedIds },
            { where: { id: link.requirementId } },
        );
        result.linked++;
        result.linkedCategories += link.addCategoryIds.length;
    }

    if (plan.copies.length) {
        const library = await getComplianceRequirementsOrThrow();
        const byId = new Map(library.map(r => [r.id, r]));

        for (const copy of plan.copies) {
            const source = byId.get(copy.sourceRequirementId);
            // The source vanished between planning and applying. Skipping is right — creating
            // a row from the dialog's stale copy would fabricate a requirement nobody wrote.
            if (!source) continue;

            const clone: ComplianceRequirement = {
                ...source,
                id: generateUUID(),
                categoryId: copy.targetCategoryId,
                // Filed where the plan said. When pooling into a section this is the section
                // the operator clicked; when fanning outward it is the source's own.
                section: copy.section,
                // A copy is INDEPENDENT. Carrying the source's link list over would quietly
                // make the copy shared with the same twelve categories, which is the exact
                // opposite of what choosing "copy" asked for.
                assignedCategoryIds: [],
            };
            await saveRequirement(clone);
            result.copied++;
        }
    }

    return result;
};

/**
 * Promote a category's requirement to a GLOBAL one — it applies to every category.
 *
 * The third scope, on top of owned and linked (see requirement-scope.utils.ts). Linking is
 * right for a family; this is right for an obligation that genuinely has no exceptions —
 * RoHS, REACH, a Bill of Materials — where maintaining a share list of all ~135 categories
 * would be a list nobody remembers to extend when a category is added.
 *
 * `assigned_category_ids` is NOT cleared here: the canonicalise trigger (migration 173) does
 * it, because a global requirement already applies everywhere and a share list on top of that
 * is contradictory rather than merely redundant. Leaving that to the one place that owns the
 * invariant means a promotion done in SQL behaves identically to one done from the UI.
 *
 * Refused by the database when the requirement reaches any FINAL category (migration 172/173)
 * — promoting changes what those categories require.
 *
 * Not reversible by a mirror function on purpose: demoting a global requirement has to choose
 * WHICH category should own it, which is a decision the caller has to make explicitly by
 * editing the requirement rather than something a "make local" button could guess.
 */
export const promoteRequirementToGlobal = async (requirementId: string): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    await db.updateWhere(
        'compliance_requirements',
        { category_id: null },
        { where: { id: requirementId } },
    );
};

/**
 * Mark a GLOBAL requirement not applicable to one category, or applicable again
 * (migration 176).
 *
 * Reads the row first rather than computing the array from whatever the UI held — two people
 * excluding different categories in the same minute must not overwrite each other with a
 * stale list. Same reasoning as `unlinkRequirementFromCategory`.
 *
 * Silently does nothing when the row is already in the requested state, so a double-click
 * cannot produce a spurious history entry.
 *
 * Refused by the database when the category itself is FINAL: excluding a requirement from a
 * frozen category changes what that category requires. The guard checks only the categories
 * ENTERING or LEAVING the exclusion list, so editing an excluded requirement's text is still
 * allowed — a global requirement is not held hostage by one locked category (migration 172).
 */
export const setRequirementApplicability = async (
    requirementId: string,
    categoryId: string,
    applicable: boolean,
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    const row = await db.selectOne<Row>('compliance_requirements', {
        columns: 'excluded_category_ids',
        where: { id: requirementId },
    });
    const current: string[] = row?.excluded_category_ids ?? [];
    const isExcluded = current.includes(categoryId);
    if (applicable === !isExcluded) return;

    const next = applicable
        ? current.filter(id => id !== categoryId)
        : [...current, categoryId];

    await db.updateWhere(
        'compliance_requirements',
        { excluded_category_ids: next },
        { where: { id: requirementId } },
    );
};

/**
 * Replace a global requirement's whole exclusion list — the Global view's editor, where the
 * operator sees every exception at once rather than one category at a time.
 *
 * Takes the complete list so removing an exclusion is expressible; the canonicalise trigger
 * de-duplicates and drops blanks.
 */
export const setRequirementExclusions = async (
    requirementId: string,
    excludedCategoryIds: readonly string[],
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    await db.updateWhere(
        'compliance_requirements',
        { excluded_category_ids: [...new Set(excludedCategoryIds)] },
        { where: { id: requirementId } },
    );
};

/**
 * Stop one category from receiving a shared requirement, leaving it for the others.
 *
 * Reads the row first rather than computing the new array from whatever the UI held, matching
 * `unassignAttributeFromCategory`: two operators unsharing different categories in the same
 * minute must not overwrite each other's change with a stale array.
 *
 * Refused by the database when the requirement reaches any FINAL category — including the one
 * being removed, since removing a requirement from a locked category changes its frozen set.
 */
export const unlinkRequirementFromCategory = async (
    requirementId: string,
    categoryId: string,
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    const row = await db.selectOne<Row>('compliance_requirements', {
        columns: 'assigned_category_ids',
        where: { id: requirementId },
    });
    const current: string[] = row?.assigned_category_ids ?? [];
    if (!current.includes(categoryId)) return;
    await db.updateWhere(
        'compliance_requirements',
        { assigned_category_ids: current.filter(id => id !== categoryId) },
        { where: { id: requirementId } },
    );
};
