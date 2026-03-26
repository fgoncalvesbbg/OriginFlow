/**
 * Shared services module
 * Services used across multiple domains (notifications, dashboard, comments)
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

export {
  getDocumentComments,
  addDocumentComment
} from './document-comment.service';

export { logAccessCodeAttempt } from '../apiService';
