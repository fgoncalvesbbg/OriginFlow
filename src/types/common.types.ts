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
  portalToken?: string;
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
