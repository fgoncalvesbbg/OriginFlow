/**
 * Shared services module
 * Services used across multiple domains (notifications, dashboard, project inbox)
 */

export {
  getDashboardStats
} from './dashboard.service';

export {
  getInboxSnapshot,
  dismissInboxItem,
  dismissInboxItems,
  restoreInboxItem
} from './pm-inbox.service';

export {
  getNotifications,
  getSupplierNotifications,
  markNotificationRead,
  triggerEmailNotification
} from './notification.service';
