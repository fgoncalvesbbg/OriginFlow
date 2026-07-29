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
 * Get all notifications for the current user
 */
export const getNotifications = async (): Promise<Notification[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('notifications', { order: { column: 'created_at', ascending: false } }),
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
        const existing = await db.selectMaybeOne<Row>('notifications', {
            columns: 'id',
            where: { supplier_id: payload.supplierId, link: payload.link },
            limit: 1,
        });

        if (existing?.id) {
            await db.updateWhere(
                'notifications',
                { message: payload.message, is_read: false },
                { where: { id: existing.id } },
            );
            return;
        }

        await db.insertMany('notifications', [{
            supplier_id: payload.supplierId,
            message: payload.message,
            link: payload.link,
            is_read: false,
            created_at: new Date().toISOString()
        }]);
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
