/**
 * Project service
 * Core project CRUD operations and management
 */

import { auth, db, portalDb, orEmpty, orUndefined, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { Project, ProjectOverallStatus, ProjectMilestones } from '../../types';
import { mapProject } from '../../utils/mappers.utils';
import { generateUUID } from '../../utils';

/** Bound for dashboard reads so a stalled connection fails fast instead of hanging the spinner. */
const READ_TIMEOUT_MS = 20000;

/**
 * Get all projects
 */
export const getProjects = async (): Promise<Project[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        withDeadline((signal) => db.select<Row>('projects', { signal }), READ_TIMEOUT_MS, 'getProjects'),
        'getProjects',
    );
    return rows.map(mapProject);
};

/**
 * Get project by ID
 */
export const getProjectById = async (id: string): Promise<Project | undefined> => {
    if (!id || !isLive) return undefined;
    const row = await orUndefined(db.selectMaybeOne<Row>('projects', { where: { id } }), 'getProjectById');
    return row ? mapProject(row) : undefined;
};

/**
 * Get project by supplier link token
 */
export const getProjectByToken = async (token: string): Promise<Project | undefined> => {
    if (!isLive) return undefined;
    // Token-scoped routine on the public client: authorization lives in the routine itself.
    const result = await orUndefined(
        portalDb.rpc<Row | Row[] | null>('get_project_by_token_secure', { p_token: token }),
        'getProjectByToken',
    );
    const row = Array.isArray(result) ? result[0] : result;
    return row ? mapProject(row) : undefined;
};

/**
 * Get all projects for a supplier
 */
export const getProjectsBySupplierId = async (supplierId: string): Promise<Project[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('projects', { where: { supplier_id: supplierId } }),
        'getProjectsBySupplierId',
    );
    return rows.map(mapProject);
};

/**
 * Get all projects accessible by supplier token
 */
export const getProjectsBySupplierToken = async (token: string): Promise<Project[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        portalDb.rpc<Row[]>('get_projects_by_supplier_token', { p_token: token }),
        'getProjectsBySupplierToken',
    );
    return (rows || []).map(mapProject);
};

/**
 * Create a new project with initial steps and documents
 */
export const createProject = async (name: string, supplierId: string, projectId: string, pmId: string, categoryId?: string): Promise<Project> => {
    const user = await auth.getUser();

    const created = await db.insert<Row>('projects', {
        name,
        supplier_id: supplierId,
        project_id_code: projectId,
        pm_id: pmId,
        category_id: categoryId || null,
        created_by: user?.id,
        status: ProjectOverallStatus.IN_PROGRESS,
        current_step: 1,
        created_at: new Date().toISOString(),
        supplier_link_token: generateUUID()
    });

    const project = mapProject(created);

    const seedChecklist = async () => {
        try {
            const stepsPayload = [
                { project_id: project.id, step_number: 1, name: 'RFQ', status: 'in_progress' },
                { project_id: project.id, step_number: 2, name: 'Business Case & Development', status: 'not_started' },
                { project_id: project.id, step_number: 3, name: 'Production', status: 'not_started' }
            ];

            await db.insertMany('project_steps', stepsPayload);

            const docsPayload = [
                { project_id: project.id, step_number: 1, title: 'RFQ Specification', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 1, title: 'Supplier Quote', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 2, title: '3D CAD Files', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 2, title: 'Product Photos', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Final Design Specs', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Final IM', responsible_party: 'supplier', is_visible_to_supplier: true, is_required: true, status: 'not_started' },
                { project_id: project.id, step_number: 3, title: 'Packaging Guidelines', responsible_party: 'internal', is_visible_to_supplier: true, is_required: true, status: 'not_started' }
            ];

            await db.insertMany('project_documents', docsPayload);
        } catch(e) {
            console.error("Failed to seed launch checklist. Check row-level-security permissions.", e);
        }
    };

    await seedChecklist();

    return project;
};

/**
 * Update project information
 */
export const updateProject = async (id: string, updates: Partial<Project>): Promise<Project> => {
    const payload: Row = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.currentStep !== undefined) payload.current_step = updates.currentStep;
    if (updates.milestones !== undefined) payload.milestones = updates.milestones;
    if (updates.projectId !== undefined) payload.project_id_code = updates.projectId;
    if (updates.supplierId !== undefined) payload.supplier_id = updates.supplierId;
    if (updates.pmId !== undefined) payload.pm_id = updates.pmId;

    const data = await db.update<Row>('projects', payload, { where: { id } });
    if (!data) throw new Error("Project not found or update failed (returned null data)");
    return mapProject(data);
};

/**
 * Delete a project
 */
export const deleteProject = async (id: string): Promise<void> => {
    await db.delete('projects', { where: { id } });
};

/**
 * Save project milestones (PO Placement, Mass Production, ETD, ETA)
 */
export const saveProjectMilestones = async (projectId: string, milestones: ProjectMilestones): Promise<void> => {
    await updateProject(projectId, { milestones });
};
