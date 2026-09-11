/**
 * Project service
 * Core project CRUD operations and management
 */

import { auth, db, portalDb, orEmpty, orUndefined, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { Project, ProjectOverallStatus, ProjectMilestones } from '../../types';
import { mapProject } from '../../utils/mappers.utils';
import { generateUUID } from '../../utils';
import { getDefaultTemplateStructure } from './project-template.service';
// Imported from the service file, not the barrel: the documents module speaks HTTP to
// /api/doc and pulling it in through services/index.ts would drag the whole barrel into
// this one's import graph.
import { bindTemplateDocumentsToProject } from '../documents/document.service';
import { requestSupplierDraft, openReEditRequirementSlot } from '../im/im-draft.service';
import { createProjectSku } from './project-sku.service';

/** Bound for dashboard reads so a stalled connection fails fast instead of hanging the spinner. */
const READ_TIMEOUT_MS = 20000;

/**
 * Get all projects.
 *
 * Re-edits (migration 182) are EXCLUDED by default. They are skeletal, IM-only projects
 * with no phases, no documents and no supplier, so every launch-facing surface that lists
 * or offers projects — the PM board, the timeline, supplier counts, and the compliance /
 * design-spec / documents pickers — would show something unusable. Filtering here rather
 * than in each of those callers is what keeps the exclusion from being forgotten in the
 * next picker somebody adds.
 *
 * Pass `{ includeReEdits: true }` to get everything; the IM module is the only place that
 * legitimately wants both.
 */
export const getProjects = async (opts?: { includeReEdits?: boolean }): Promise<Project[]> => {
    if (!isLive) return [];
    const where = opts?.includeReEdits ? undefined : { kind: 'launch' };
    const rows = await orEmpty(
        withDeadline((signal) => db.select<Row>('projects', { where, signal }), READ_TIMEOUT_MS, 'getProjects'),
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
    // `kind` is redundant with `supplier_id` today (a re-edit has no supplier, so it can
    // never match) but is stated anyway: the day someone sets a supplier on a re-edit for
    // reference, it must still not appear in a supplier's list.
    const rows = await orEmpty(
        db.select<Row>('projects', { where: { supplier_id: supplierId, kind: 'launch' } }),
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

    /**
     * Phases and their required documents come from the admin-defined default project
     * template (Admin panel → Project Templates) rather than being hardcoded here, so an
     * admin can change what a new launch starts with without a code deploy.
     */
    const seedChecklist = async (): Promise<string | undefined> => {
        try {
            const structure = await getDefaultTemplateStructure();
            if (!structure || structure.steps.length === 0) {
                console.error("No default project template configured. Set one under Admin panel > Project Templates.");
                return undefined;
            }

            const stepsPayload = structure.steps.map((step, i) => ({
                project_id: project.id,
                step_number: step.stepNumber,
                name: step.name,
                status: i === 0 ? 'in_progress' : 'not_started',
            }));

            await db.insertMany('project_steps', stepsPayload);

            const docsPayload = structure.documents.map((doc) => ({
                project_id: project.id,
                step_number: doc.stepNumber,
                title: doc.title,
                description: doc.description,
                responsible_party: doc.responsibleParty,
                is_visible_to_supplier: doc.isVisibleToSupplier,
                is_required: doc.isRequired,
                status: 'not_started',
            }));

            if (docsPayload.length > 0) await db.insertMany('project_documents', docsPayload);

            return structure.templateId;
        } catch(e) {
            console.error("Failed to seed launch checklist. Check row-level-security permissions.", e);
            return undefined;
        }
    };

    /**
     * The registry documents the same template hands down (Admin panel > Project Templates >
     * Standard documents), attached as doc_bindings so the project shows the CURRENT final
     * version of each — a packaging guideline the project reads, not a slot it has to fill.
     * Contrast the checklist above, which stamps COPIES of titles into project_documents.
     *
     * Server-side, because template_doc_bindings and doc_bindings are both server-only
     * (migration 159). The templateId is passed explicitly rather than letting the server
     * resolve the default again, so the documents provably come from the same template
     * whose phases were just stamped even if an admin flips the default mid-creation.
     *
     * Non-fatal by design, exactly like seedChecklist: a project that exists with no
     * standard documents attached is recoverable from the project's Documents tab, whereas
     * a creation that throws after the row is already committed leaves a project the PM
     * believes failed. Both are logged.
     */
    const templateId = await seedChecklist();

    if (templateId) {
        try {
            await bindTemplateDocumentsToProject(project.id, templateId);
        } catch (e) {
            console.error("Failed to attach the template's standard documents. Add them from the project's Documents tab.", e);
        }
    }

    /**
     * The supplier's draft instruction manual (migrations 179/180). Asked for on EVERY
     * launch, not on request: the draft is part of the process, and a request a PM has to
     * remember to open is one the supplier mostly never hears about.
     *
     * It is shown to the supplier inside phase `step_number` (2 — Business Case &
     * Development) and, until the project reaches that phase, the board reads the project as
     * plain Backlog rather than as waiting on the supplier. Nothing about it blocks the
     * technical writer at any point.
     *
     * Non-fatal, exactly like seedChecklist and the standard documents above: a project that
     * exists without a draft request is recoverable from its IM screen, whereas throwing
     * here would leave a PM believing a creation failed after the row was already committed.
     */
    try {
        await requestSupplierDraft(project.id, 'im', {
            requestedBy: user?.email ?? null,
            note: 'Standard for every launch: your draft of the instruction manual.',
        });
    } catch (e) {
        console.error("Failed to open the supplier draft request. Request it from the project's IM screen.", e);
    }

    return project;
};

/** What the Re-Edit form collects. */
export interface ReEditProjectInput {
    name: string;
    /** What must change and why. Mandatory — the database rejects a blank one too. */
    requirement: string;
    /** The live SKUs this re-edit covers. Copied into `project_skus` rows of their own. */
    skus: Array<{ skuNumber: string; skuTitle: string }>;
    categoryId?: string | null;
    /** The launch project whose IM this revises, when it is known. */
    sourceProjectId?: string | null;
}

/**
 * Create a Re-Edit project — a skeletal, IM-only project for a SKU that is already live.
 *
 * A deliberate sibling of `createProject` rather than a flag on it, because it has to skip
 * all three of that function's side effects: no phase checklist, no standard documents, and
 * above all no supplier draft request (a re-edit has no supplier to ask, and the request
 * would sit pending forever).
 *
 * Two details that are easy to get wrong:
 *
 *  - `supplier_link_token` must be an explicit NULL. The column DEFAULTs to a random hex,
 *    and `SupplierPortal` is driven entirely by that token and never reads `supplier_id` —
 *    so omitting it would leave a working supplier portal on a project that has no supplier.
 *  - `pm_id` is set to the creator even though the form never asks for a PM.
 *    `can_see_project()` is `ADMIN OR pm_id = auth.uid()`, so pm_id IS the access-control
 *    rule for the project and every child row; a NULL there would hide the re-edit from the
 *    very person who just made it and 403 its IM print and file URLs.
 *
 * The code is claimed on save, not when the form opens, so an abandoned form burns no
 * number in the sequence.
 */
export const createReEditProject = async (input: ReEditProjectInput): Promise<Project> => {
    const user = await auth.getUser();

    const requirement = input.requirement.trim();
    if (!requirement) throw new Error('Say what must change and why — a re-edit without a requirement cannot be actioned.');

    const code = await db.rpc<string>('next_reedit_code');
    if (!code) throw new Error('Could not assign a re-edit code. Try again.');

    const created = await db.insert<Row>('projects', {
        name: input.name,
        project_id_code: code,
        kind: 'reedit',
        reedit_requirement: requirement,
        source_project_id: input.sourceProjectId || null,
        supplier_id: null,
        pm_id: user?.id ?? null,
        category_id: input.categoryId || null,
        created_by: user?.id,
        status: ProjectOverallStatus.IN_PROGRESS,
        current_step: 1,
        created_at: new Date().toISOString(),
        supplier_link_token: null,
    });

    const project = mapProject(created);

    /**
     * Non-fatal, for the same reason the launch path's seeding is: the project row is
     * already committed, and throwing here would report a failure for something that half
     * happened. Missing SKUs are recoverable from the project's own SKU list.
     */
    try {
        for (const [i, sku] of input.skus.entries()) {
            await createProjectSku(project.id, sku.skuNumber, sku.skuTitle, [], i, input.categoryId ?? null);
        }
    } catch (e) {
        console.error('Failed to attach every SKU to the re-edit. Add the missing ones from the project.', e);
    }

    /**
     * The requirement slot. The text already lives on the project row — this mirrors it into
     * the draft tables so the writer's brief panel and the PDF attachment pipeline, both of
     * which hang off `im_draft_requests`, work on a re-edit exactly as they do on a launch.
     * `draftStepOf` short-circuits on the kind, so this row never reads as a supplier ask.
     */
    try {
        await openReEditRequirementSlot(project.id, requirement, user?.email ?? null);
    } catch (e) {
        console.error('Failed to record the re-edit requirement slot. The requirement is still on the project.', e);
    }

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
