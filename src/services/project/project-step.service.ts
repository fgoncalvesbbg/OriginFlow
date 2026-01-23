/**
 * Project step service
 * Manages project workflow steps (RFQ, Development, Production, etc.)
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectStep, StepStatus } from '../../types';
import { mapProjectStep } from '../../utils/mappers.utils';

/**
 * Get all steps for a project
 */
export const getProjectSteps = async (projectId: string): Promise<ProjectStep[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('project_steps').select('*').eq('project_id', projectId).order('step_number');
    if (error) return [];
    return (data || []).map(mapProjectStep);
};

/**
 * Update the status of a project step
 */
export const updateStepStatus = async (stepId: string, status: StepStatus): Promise<void> => {
    await supabase.from('project_steps').update({ status }).eq('id', stepId);
};
