/**
 * Common types used across multiple modules
 */

export enum UserRole {
  ADMIN = 'ADMIN',
  PM = 'PM',
  SUPPLIER = 'SUPPLIER'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
}

export interface Supplier {
  id: string;
  name: string;
  code: string;
  email: string;
  pmId?: string;
  assignedPMIds?: string[];
  assignedPMNames?: string[];
  portalToken?: string;
  accessCode?: string;
  /**
   * Whether an access code is configured for this supplier. Set by the portal
   * bootstrap RPC (get_supplier_by_token_safe) WITHOUT exposing the code itself.
   * The actual code is never sent to the browser; verification happens server-side
   * via verify_supplier_access.
   */
  hasAccessCode?: boolean;
}

export interface DeadlineItem {
    id: string;
    projectId: string;
    title: string;
    projectName: string;
    deadline: string;
    daysLeft: number;
    type: 'doc' | 'tcf';
}

export interface DashboardStats {
    activeProjects: number;
    pendingReviews: number;
    overdueCount: number;
    upcomingDeadlines: DeadlineItem[];
}

export interface Notification {
  id: string;
  userId: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}
