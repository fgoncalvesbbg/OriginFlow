/**
 * Shared services module
 * Services used across multiple domains (notifications, dashboard)
 */

export {
  getDashboardStats
} from './dashboard.service';

export {
  getNotifications,
  getSupplierNotifications,
  markNotificationRead,
  triggerEmailNotification
} from './notification.service';
