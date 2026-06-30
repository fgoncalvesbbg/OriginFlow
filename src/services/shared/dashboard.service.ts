/**
 * Dashboard service
 * Dashboard statistics and deadline calculations
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { DashboardStats, DeadlineItem, ProjectOverallStatus } from '../../types';

/**
 * Get dashboard statistics including active projects, pending reviews, overdue items, and upcoming deadlines
 */
export const getDashboardStats = async (): Promise<DashboardStats & { newProposals: number }> => {
    if (!isLive) return { activeProjects: 0, pendingReviews: 0, overdueCount: 0, upcomingDeadlines: [], newProposals: 0 };

    const today = new Date();
    const nextPeriod = new Date();
    nextPeriod.setDate(today.getDate() + 14);

    const [projectsRes, docsRes, proposalsRes, tcfRes, deadlineDocsRes] = await Promise.all([
        supabase.from('projects').select('status').limit(1000),
        supabase.from('project_documents').select('*, projects!inner(name)').eq('status', 'uploaded').limit(500),
        supabase.from('supplier_proposals').select('id').eq('status', 'new').limit(500),
        supabase.from('compliance_requests').select('*, projects!inner(name)').eq('status', 'pending_supplier').limit(500),
        supabase.from('project_documents')
            .select('*, projects!inner(name)')
            .not('deadline', 'is', null)
            .neq('status', 'approved')
            .lte('deadline', nextPeriod.toISOString())
            .order('deadline')
            .limit(500)
    ]);

    const projects = projectsRes.data || [];
    const activeProjects = projects.filter(p => p.status === ProjectOverallStatus.IN_PROGRESS).length;
    const pendingReviews = (docsRes.data || []).length;
    const newProposals = (proposalsRes.data || []).length;

    // Process TCF deadlines
    const tcfDeadlines = (tcfRes.data || []).filter(r => r.deadline).map(r => {
        const dDate = new Date(r.deadline);
        const diff = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        return {
            id: r.id,
            projectId: r.project_id,
            title: `TCF Request: ${r.request_id}`,
            projectName: r.project_name || 'Standalone',
            deadline: r.deadline,
            daysLeft: diff,
            type: 'tcf'
        } as DeadlineItem;
    });

    const docDeadlines = (deadlineDocsRes.data || []).map((d: any) => {
        const dDate = new Date(d.deadline);
        const diff = Math.ceil((dDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
        return {
            id: d.id,
            projectId: d.project_id,
            title: d.title,
            projectName: d.projects?.name || 'Unknown',
            deadline: d.deadline,
            daysLeft: diff,
            type: 'doc'
        } as DeadlineItem;
    });

    const combined = [...docDeadlines, ...tcfDeadlines].sort((a, b) => a.daysLeft - b.daysLeft);
    const overdueCount = combined.filter(c => c.daysLeft < 0).length;

    return {
        activeProjects,
        pendingReviews,
        overdueCount,
        upcomingDeadlines: combined,
        newProposals
    };
};
