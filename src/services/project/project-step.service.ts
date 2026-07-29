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
 * Update the status of a project step
 */
export const updateStepStatus = async (stepId: string, status: StepStatus): Promise<void> => {
    await db.updateWhere('project_steps', { status }, { where: { id: stepId } });
};
