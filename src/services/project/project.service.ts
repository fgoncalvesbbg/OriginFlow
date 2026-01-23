/**
 * Project service
 * Core project CRUD operations and management
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { Project, ProjectOverallStatus, ProjectMilestones, ProjectStep, ProjectDocument } from '../../types';
import { mapProject, mapProjectStep, mapProjectDocument } from '../../utils/mappers.utils';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all projects
 */
export const getProjects = async (): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('projects').select('*');
    if (error) {
        console.error("getProjects failed", error);
        return [];
    }
    return (data || []).map(mapProject);
};

/**
 * Get project by ID
 */
export const getProjectById = async (id: string): Promise<Project | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapProject(data);
};

/**
 * Get project by supplier link token
 */
export const getProjectByToken = async (token: string): Promise<Project | undefined> => {
    if (!isLive) return undefined;
    const { data: rpcData, error: rpcError } = await portalClient.rpc('get_project_by_token_secure', { p_token: token });

    if (!rpcError && rpcData && rpcData.length > 0) {
        return mapProject(rpcData[0]);
    }
    return undefined;
};

/**
 * Get all projects for a supplier
 */
export const getProjectsBySupplierId = async (supplierId: string): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('projects').select('*').eq('supplier_id', supplierId);
    if (error) return [];
    return (data || []).map(mapProject);
};

/**
 * Get all projects accessible by supplier token
 */
export const getProjectsBySupplierToken = async (token: string): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.rpc('get_projects_by_supplier_token', { p_token: token });
    if (error) return [];
    return (data || []).map(mapProject);
};

/**
 * Create a new project with initial steps and documents
 */
export const createProject = async (name: string, supplierId: string, projectId: string, pmId: string): Promise<Project> => {
    const { data, error } = await supabase.from('projects').insert({
        name,
        supplier_id: supplierId,
        project_id_code: projectId,
        pm_id: pmId,
        status: ProjectOverallStatus.IN_PROGRESS,
        current_step: 1,
        created_at: new Date().toISOString(),
        supplier_link_token: generateUUID()
    }).select().single();

    if (error) handleError(error, 'createProject');
    const project = mapProject(data);

    const seedChecklist = async () => {
        try {
            const stepsPayload = [
                { project_id: project.id, step_number: 1, name: 'RFQ', status: 'in_progress' },
                { project_id: project.id, step_number: 2, name: 'Business Case & Development', status: 'not_started' },
                { project_id: project.id, step_number: 3, name: 'Production', status: 'not_started' }
            ];

            await supabase.from('project_steps').insert(stepsPayload);

            const docsPayload = [
                { project_id: project.id, step_number: 1, title: 'RFQ Specification', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 1, title: 'Supplier Quote', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 2, title: '3D CAD Files', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 2, title: 'Product Photos', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Final Design Specs', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Final IM', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Packaging Guidelines', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' }
            ];

            await supabase.from('project_documents').insert(docsPayload);
        } catch(e) {
            console.error("Failed to seed launch checklist. Check RLS permissions.", e);
        }
    };

    await seedChecklist();

    return project;
};

/**
 * Update project information
 */
export const updateProject = async (id: string, updates: Partial<Project>): Promise<Project> => {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.currentStep !== undefined) payload.current_step = updates.currentStep;
    if (updates.milestones !== undefined) payload.milestones = updates.milestones;
    if (updates.projectId !== undefined) payload.project_id_code = updates.projectId;
    if (updates.supplierId !== undefined) payload.supplier_id = updates.supplierId;
    if (updates.pmId !== undefined) payload.pm_id = updates.pmId;

    const { data, error } = await supabase.from('projects').update(payload).eq('id', id).select().single();
    if (error) handleError(error, 'updateProject');
    if (!data) throw new Error("Project not found or update failed (returned null data)");
    return mapProject(data);
};

/**
 * Delete a project
 */
export const deleteProject = async (id: string): Promise<void> => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) handleError(error, 'deleteProject');
};

/**
 * Save project milestones (POPlacement, Mass Production, ETD, ETA)
 */
export const saveProjectMilestones = async (projectId: string, milestones: ProjectMilestones): Promise<void> => {
    await updateProject(projectId, { milestones });
};
