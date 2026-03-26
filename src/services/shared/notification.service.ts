/**
 * Notification service
 * Manages notifications for users and suppliers
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { Notification } from '../../types';

/**
 * Get all notifications for the current user
 */
export const getNotifications = async (): Promise<Notification[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map((n: any) => ({
        id: n.id,
        userId: n.user_id,
        message: n.message,
        link: n.link,
        isRead: n.is_read,
        createdAt: n.created_at
    }));
};

/**
 * Get notifications for a specific supplier
 */
export const getSupplierNotifications = async (supplierId: string): Promise<Notification[]> => {
    if (!isLive || !supplierId) return [];
    try {
        const { data, error } = await portalClient.from('notifications').select('*').eq('supplier_id', supplierId);
        if (error) {
            console.warn('Failed to fetch notifications:', error.message);
            return [];
        }
        return (data || []).map((n: any) => ({
            id: n.id,
            userId: n.user_id,
            message: n.message,
            link: n.link,
            isRead: n.is_read,
            createdAt: n.created_at
        }));
    } catch (err: any) {
        console.warn('Notifications service error:', err.message);
        return [];
    }
};

/**
 * Mark a notification as read
 */
export const markNotificationRead = async (id: string): Promise<void> => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
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

    const { data: existing, error: findError } = await supabase
        .from('notifications')
        .select('id')
        .eq('supplier_id', payload.supplierId)
        .eq('link', payload.link)
        .maybeSingle();

    if (findError) {
        console.warn('Failed to query existing supplier notification:', findError.message);
        return;
    }

    if (existing?.id) {
        const { error: updateError } = await supabase
            .from('notifications')
            .update({
                message: payload.message,
                is_read: false
            })
            .eq('id', existing.id);

        if (updateError) console.warn('Failed to update supplier notification:', updateError.message);
        return;
    }

    const { error: insertError } = await supabase.from('notifications').insert({
        user_id: payload.supplierId,
        supplier_id: payload.supplierId,
        message: payload.message,
        link: payload.link,
        is_read: false,
        created_at: new Date().toISOString()
    });

    if (insertError) console.warn('Failed to create supplier notification:', insertError.message);
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
