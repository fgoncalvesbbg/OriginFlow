/**
 * Project milestone service
 * Handles project milestones (PO Placement, Mass Production, ETD, ETA)
 */

import { ProjectMilestones } from '../../types';
import { updateProject } from './project.service';

/**
 * Save/update project milestones
 */
export const saveProjectMilestones = async (projectId: string, milestones: ProjectMilestones): Promise<void> => {
    await updateProject(projectId, { milestones });
};
