/**
 * TCF requirement lock & history (migration 172).
 *
 * A category whose requirement set is marked FINAL is frozen: no requirement of that
 * category can be created, edited or deleted until an ADMIN releases it and says why. None
 * of that is enforced here — it is enforced by triggers, which is the point. This module is
 * the front door, not the gate:
 *
 *  - `lockCategoryRequirements` / `releaseCategoryRequirements` call the two RPCs, which
 *    carry the note/reason into the transaction so the history can record it.
 *  - `canReleaseComplianceCategory` is a UI HINT and nothing more. It mirrors the guard's
 *    role check so the button and the database agree, and it fails closed: a failed read
 *    hides the release control rather than offering one that will be refused.
 *  - `getRequirementHistory` reads the append-only trail. The table has no write grant for
 *    anyone, so there is deliberately no "add history entry" function in this file.
 *
 * The lock covers a category's OWN requirements. Global requirements (categoryId null) are
 * not frozen by it — see the migration header for why — though their changes are logged.
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { ComplianceHistoryAction, ComplianceRequirementHistoryEntry } from '../../types';

/**
 * Shortest release reason the database will accept. Duplicated from the migration on purpose:
 * the dialog has to be able to disable its own button, and a round trip to discover the
 * minimum length would make the form feel broken. The database remains the authority — if
 * these two ever disagree, the write is refused and the operator sees the SQL message.
 */
export const RELEASE_REASON_MIN_LENGTH = 10;

/** Whether `reason` is long enough to be accepted. Trims first, like the database does. */
export const isValidReleaseReason = (reason: string): boolean =>
    reason.trim().length >= RELEASE_REASON_MIN_LENGTH;

const fromHistoryRow = (r: Row): ComplianceRequirementHistoryEntry => ({
    id: Number(r.history_id),
    categoryId: r.category_id ?? null,
    requirementId: r.requirement_id ?? null,
    action: r.action as ComplianceHistoryAction,
    title: r.title ?? null,
    section: r.section ?? null,
    reason: r.reason ?? null,
    before: (r.before_json ?? null) as Record<string, unknown> | null,
    after: (r.after_json ?? null) as Record<string, unknown> | null,
    changedFields: Array.isArray(r.changed_fields) ? r.changed_fields : [],
    linkedCategoryIds: Array.isArray(r.linked_category_ids) ? r.linked_category_ids : [],
    changedAt: r.changed_at,
    changedBy: r.changed_by ?? null,
});

/**
 * One category's requirement history, newest first.
 *
 * Pass `null` for the global requirement set.
 *
 * TWO READS, because a category's history is not just the rows homed to it. A requirement
 * LINKED to this category (migration 173) lives under another category's `category_id`, and
 * an edit to it changes what THIS category requires — so it belongs here. The trigger stamps
 * `linked_category_ids` for exactly this lookup. The port has no OR, so this follows the
 * same two-reads-and-merge shape `getRoadmapAudit` uses; a single read would leave a silent
 * gap precisely where a shared change happened, which is the worst place for one.
 *
 * A degrading read (`orEmpty`) because this is a read-only panel: an empty history reads as
 * "nothing recorded yet", which is honest for a failed read and costs nobody their work.
 * Never use it to gate a write.
 */
export const getRequirementHistory = async (
    categoryId: string | null,
    limit = 200,
): Promise<ComplianceRequirementHistoryEntry[]> => {
    if (!isLive) return [];
    const capped = Math.min(Math.max(limit, 1), 1000);
    const order = { column: 'changed_at', ascending: false } as const;

    const own = orEmpty(
        db.select<Row>('compliance_requirement_history', {
            where: { category_id: categoryId },
            order,
            limit: capped,
        }),
        'getRequirementHistory.own',
    );

    // Global requirements are not linked to anything (the canonicalise trigger keeps their
    // list empty), so the global view has no second half to read.
    const shared = categoryId === null
        ? Promise.resolve([] as Row[])
        : orEmpty(
            db.select<Row>('compliance_requirement_history', {
                where: { linked_category_ids: { op: 'arrayContains', value: [categoryId] } },
                order,
                limit: capped,
            }),
            'getRequirementHistory.shared',
        );

    const [ownRows, sharedRows] = await Promise.all([own, shared]);

    // De-duplicated by history_id: a requirement homed here AND linked elsewhere matches both
    // reads, and the same event must not appear twice in the list.
    const byId = new Map<number, ComplianceRequirementHistoryEntry>();
    for (const entry of [...ownRows, ...sharedRows].map(fromHistoryRow)) byId.set(entry.id, entry);

    // `changed_at` has second-or-better resolution but a lock and the edit that provoked it can
    // share a timestamp, so history_id breaks the tie — it is the only strictly ordered column.
    return [...byId.values()]
        .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id - a.id)
        .slice(0, capped);
};

/**
 * Mark a category's TCF requirements FINAL. Open to any signed-in staff user — signing off a
 * finished set is normal work; it is the UNDOING that needs an administrator.
 *
 * Does not degrade: the caller shows the database's own message, because "already FINAL" and
 * "no such category" are both things the operator needs to be told rather than a silent no-op.
 */
export const lockCategoryRequirements = async (
    categoryId: string,
    note?: string | null,
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    await db.rpc<void>('lock_compliance_category', {
        p_category_id: categoryId,
        p_note: note?.trim() || null,
    });
};

/**
 * Release a FINAL category so its requirements can be edited again. ADMIN only, and the
 * reason is mandatory — both enforced by the database, and both re-checked here so a
 * too-short reason never leaves the browser.
 */
export const releaseCategoryRequirements = async (
    categoryId: string,
    reason: string,
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    if (!isValidReleaseReason(reason)) {
        throw new Error(
            `Say why this category is being released — at least ${RELEASE_REASON_MIN_LENGTH} characters. It goes on the record.`,
        );
    }
    await db.rpc<void>('release_compliance_category', {
        p_category_id: categoryId,
        p_reason: reason.trim(),
    });
};

/**
 * Whether the signed-in user may release a FINAL category. A UI hint — fails CLOSED, so a
 * failed check hides the control rather than showing one the database will refuse.
 */
export const canReleaseComplianceCategory = async (): Promise<boolean> => {
    if (!isLive) return false;
    try {
        return (await db.rpc<boolean>('is_compliance_release_admin')) === true;
    } catch (err) {
        console.warn('[compliance-lock] release-admin check failed; hiding the control', err);
        return false;
    }
};
