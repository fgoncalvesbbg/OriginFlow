/**
 * Notification service
 * Manages notifications for users and suppliers
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { Notification } from '../../types';

const mapNotification = (n: any): Notification => ({
    id: n.id,
    userId: n.user_id,
    message: n.message,
    link: n.link,
    isRead: n.is_read,
    createdAt: n.created_at
});

/**
 * Get the notifications addressed to one user.
 *
 * `userId` is required. This read used to take no argument and no filter — it selected the
 * whole table, and the row-level-security policy of the day (`using (auth.role() =
 * 'authenticated')`) let it succeed, so every signed-in user's bell rendered every other
 * user's mail. Every row in the table is in fact supplier-directed, complete with a
 * `/compliance/supplier/<token>` link, so the staff bell was also handing out supplier
 * portal tokens. Migration 148 restricts the policy to own rows; the filter here states
 * the same rule in the query, so a policy regression shows up as an empty bell rather
 * than as somebody else's inbox.
 */
export const getNotifications = async (userId: string): Promise<Notification[]> => {
    if (!isLive || !userId) return [];
    const rows = await orEmpty(
        db.select<Row>('notifications', {
            where: { user_id: userId, dismissed_at: { op: 'isNull' } },
            order: { column: 'created_at', ascending: false },
        }),
        'getNotifications',
    );
    return rows.map(mapNotification);
};

/**
 * Get notifications for a specific supplier
 */
export const getSupplierNotifications = async (supplierId: string): Promise<Notification[]> => {
    if (!isLive || !supplierId) return [];
    const rows = await orEmpty(
        portalDb.select<Row>('notifications', { where: { supplier_id: supplierId } }),
        'getSupplierNotifications',
    );
    return rows.map(mapNotification);
};

/**
 * Mark a notification as read
 */
export const markNotificationRead = async (id: string): Promise<void> => {
    await db.updateWhere('notifications', { is_read: true }, { where: { id } });
};

/**
 * Create or update a supplier notification keyed by supplier + link.
 * This keeps deadline reminders idempotent across repeated app mounts.
 */
export const upsertSupplierNotification = async (payload: {
    supplierId: string;
    message: string;
    link: string;
}): Promise<void> => {
    if (!isLive || !payload.supplierId || !payload.message || !payload.link) return;

    // Best-effort throughout: a failed reminder must never surface to the user.
    try {
        // One statement, not read-then-write. The old select-then-insert raced two app
        // mounts against each other and left duplicates in the live table (two rows for
        // the same link, 73ms apart, saying "overdue by 112 day(s)" and "153 day(s)").
        // Migration 148 dedupes what the race already produced and adds the uniqueness
        // this conflict target needs. It has to be a NON-partial index: PostgREST sends
        // `on_conflict=supplier_id,link` with no index predicate, and Postgres only
        // infers a partial index as the arbiter when the statement carries a matching
        // `ON CONFLICT ... WHERE`. 148 shipped it partial (`where supplier_id is not
        // null`), so every call failed 42P10 into the catch below until migration 168
        // dropped the redundant predicate.
        await db.upsert(
            'notifications',
            {
                supplier_id: payload.supplierId,
                message: payload.message,
                link: payload.link,
                is_read: false,
            },
            { onConflict: 'supplier_id,link' },
        );
    } catch (e) {
        console.warn('Failed to upsert supplier notification:', e);
    }
};

/**
 * Trigger email notification (currently suppressed per project settings)
 */
export const triggerEmailNotification = async (payload: {
  to: string;
  subject: string;
  html: string;
  type: 'tcf_submission' | 'test' | 'rfq_invite';
}) => {
  console.info("Email notification suppressed per project settings.", payload.type);
  return { success: true, message: "Email suppressed" };
};
