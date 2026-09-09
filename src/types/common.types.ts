/**
 * Common types used across multiple modules
 */

export enum UserRole {
  ADMIN = 'ADMIN',
  PM = 'PM',
  SUPPLIER = 'SUPPLIER',
  /**
   * The design team: owns Design Specs (upload versions, send review links, issue the
   * final). A DESIGNER is NOT an admin and NOT a PM — read-only everywhere else.
   *
   * Unlike the Super Admin tier above, this one IS a role value rather than a flag, and
   * for the opposite reason: the ~30 policies that hardcode `upper(role) = 'ADMIN'` are
   * exactly the rights a designer should not have, so being excluded by them is the
   * intent, not a hazard.
   *
   * Two things must stay true wherever this value travels (migration 163):
   *  - `doc_role_from_profile` maps it to user_roles.role = 'designer', and
   *    `netlify/functions/lib/doc-access.ts` must treat that as an INTERNAL caller.
   *    Anything it does not recognise is resolved as a supplier, which would hand a
   *    designer the supplier-audience view of SOP documents.
   *  - a DESIGNER is neither ADMIN nor a project's pm_id, so `can_see_project()` is false
   *    for them; their project visibility comes from the separate
   *    `design_editors_read_projects` SELECT policy.
   */
  DESIGNER = 'DESIGNER'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  /**
   * Super Admin tier: sees modules still under test. Deliberately a flag on top of
   * `role`, not a fourth UserRole — ~30 RLS policies hardcode `upper(role) = 'ADMIN'`,
   * so a distinct role value would silently strip a super admin's admin rights.
   * A super admin is always also an ADMIN. Absent/false for everyone else.
   */
  isSuperAdmin?: boolean;
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
  /** True when the supplier has an access code configured. Set by the portal's safe token lookup, which never exposes the code itself. */
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
