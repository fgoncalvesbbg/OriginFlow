/**
 * Project step service
 * Manages project workflow steps (RFQ, Development, Production, etc.)
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectStep, StepStatus } from '../../types';
import { mapProjectStep } from '../../utils/mappers.utils';

/**
 * Get all steps for a project
 */
export const getProjectSteps = async (projectId: string): Promise<ProjectStep[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('project_steps', {
            where: { project_id: projectId },
            order: { column: 'step_number' },
        }),
        'getProjectSteps',
    );
    return rows.map(mapProjectStep);
};

/**
 * Every project's steps in one read, keyed by project id.
 *
 * The projects board groups by the chapter a project is working (see
 * `pages/project-board-buckets.ts`), so it needs the steps of every card on screen — one query,
 * not one per project. Chunked because the id list travels in the query string.
 *
 * Fails soft: RLS grants `project_steps` to ADMIN and to a PM's own projects only, so a role
 * that can see projects but not their steps (a design editor) gets `{}` and a board that falls
 * back on `current_step` rather than an error page.
 */
export const getStepsForProjects = async (projectIds: readonly string[]): Promise<Record<string, ProjectStep[]>> => {
    const byProject: Record<string, ProjectStep[]> = {};
    if (!isLive || projectIds.length === 0) return byProject;

    const CHUNK = 150;
    for (let i = 0; i < projectIds.length; i += CHUNK) {
        const rows = await orEmpty(
            db.select<Row>('project_steps', {
                where: { project_id: { op: 'in', value: projectIds.slice(i, i + CHUNK) } },
                order: { column: 'step_number' },
            }),
            'getStepsForProjects',
        );
        for (const step of rows.map(mapProjectStep)) {
            (byProject[step.projectId] ??= []).push(step);
        }
    }
    return byProject;
};

/**
 * Update the status of a project step
 */
export const updateStepStatus = async (stepId: string, status: StepStatus): Promise<void> => {
    await db.updateWhere('project_steps', { status }, { where: { id: stepId } });
};

/**
 * Set several steps' statuses at once — grouped by status, so moving a project across the
 * board's phase columns is one write per distinct status (at most three) rather than one per
 * chapter. Sequential on purpose: the port has no transaction, and a partial apply that stops
 * early leaves the chapters in an order the board can still read.
 */
export const setStepStatuses = async (writes: readonly { id: string; status: StepStatus }[]): Promise<void> => {
    const byStatus = new Map<StepStatus, string[]>();
    for (const w of writes) {
        const ids = byStatus.get(w.status);
        if (ids) ids.push(w.id);
        else byStatus.set(w.status, [w.id]);
    }
    for (const [status, ids] of byStatus) {
        await db.updateWhere('project_steps', { status }, { where: { id: { op: 'in', value: ids } } });
    }
};

/**
 * Set (or clear) the due date for a whole phase.
 *
 * THE CASCADE IS NOT DONE HERE. A database trigger stamps this date onto every document in
 * the phase that has not overridden it, and onto the supplier's draft-manual request
 * (migration 181). Doing it in the database rather than in this function is what makes the
 * PM dashboard's overdue count, the supplier portal, the timeline and the inbox all agree:
 * they read `project_documents.deadline`, and that column is already correct by the time
 * this resolves. A loop here would only cover the callers that remembered to use it.
 *
 * Pass null to clear the phase date. Documents that were inheriting it are cleared with it;
 * overrides are left alone, which is exactly what an override is for.
 */
export const setPhaseDeadline = async (
    projectId: string,
    stepNumber: number,
    deadline: string | null,
): Promise<void> => {
    await db.updateWhere(
        'project_steps',
        { deadline: deadline || null },
        { where: { project_id: projectId, step_number: stepNumber } },
    );
};
