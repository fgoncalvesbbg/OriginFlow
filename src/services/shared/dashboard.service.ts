/**
 * Dashboard service
 * Dashboard statistics and deadline calculations
 */

import { db, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { DashboardStats, DeadlineItem, ProjectOverallStatus } from '../../types';

/** Bound for dashboard reads so a stalled connection fails fast instead of hanging the spinner. */
const READ_TIMEOUT_MS = 20000;
const EMPTY_STATS = { activeProjects: 0, pendingReviews: 0, overdueCount: 0, upcomingDeadlines: [], newProposals: 0 };

/**
 * Get dashboard statistics including active projects, pending reviews, overdue items, and upcoming deadlines
 */
export const getDashboardStats = async (): Promise<DashboardStats & { newProposals: number }> => {
    if (!isLive) return EMPTY_STATS;

    const today = new Date();
    const nextPeriod = new Date();
    nextPeriod.setDate(today.getDate() + 14);

    const results = await withDeadline(
        (signal) => Promise.all([
            db.select<Row>('projects', { columns: 'status', limit: 1000, signal }),
            db.select<Row>('project_documents', {
                columns: '*, projects!inner(name)',
                where: { status: 'uploaded' },
                limit: 500,
                signal,
            }),
            db.select<Row>('supplier_proposals', { columns: 'id', where: { status: 'new' }, limit: 500, signal }),
            db.select<Row>('compliance_requests', {
                columns: '*, projects!inner(name)',
                where: { status: 'pending_supplier' },
                limit: 500,
                signal,
            }),
            db.select<Row>('project_documents', {
                columns: '*, projects!inner(name)',
                where: {
                    deadline: [{ op: 'isNotNull' }, { op: 'lte', value: nextPeriod.toISOString() }],
                    status: { op: 'neq', value: 'approved' },
                },
                order: { column: 'deadline' },
                limit: 500,
                signal,
            }),
        ]),
        READ_TIMEOUT_MS,
        'getDashboardStats',
    ).catch((e) => {
        console.error("[read] getDashboardStats timed out or failed", e);
        return null;
    });

    if (!results) return EMPTY_STATS;
    const [projects, docs, proposals, tcf, deadlineDocs] = results;

    const activeProjects = projects.filter(p => p.status === ProjectOverallStatus.IN_PROGRESS).length;
    const pendingReviews = docs.length;
    const newProposals = proposals.length;

    // Process TCF deadlines
    const tcfDeadlines = tcf.filter(r => r.deadline).map(r => {
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

    const docDeadlines = deadlineDocs.map((d: any) => {
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
