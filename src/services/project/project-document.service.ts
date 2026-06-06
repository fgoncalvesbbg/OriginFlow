/**
 * Project document service
 * Manages project documents, file uploads, versions, and comments
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProjectDocument, DocStatus, ResponsibleParty, DocumentComment, ProjectOverallStatus } from '../../types';
import { mapProjectDocument } from '../../utils/mappers.utils';
import { handleError } from '../../utils/error.utils';
import { runMutation } from '../core/db';
import { getProjectsBySupplierId } from './project.service';

/**
 * Get all documents for a project
 */
export const getProjectDocs = async (projectId: string): Promise<ProjectDocument[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('project_documents').select('*').eq('project_id', projectId);
    if (error) return [];
    return (data || []).map(mapProjectDocument);
};

/**
 * Add a new document to a project
 */
export const addDocument = async (doc: Omit<ProjectDocument, 'id'>): Promise<ProjectDocument> => {
    const payload = {
        project_id: doc.projectId,
        step_number: doc.stepNumber,
        title: doc.title,
        description: doc.description,
        responsible_party: doc.responsibleParty,
        is_visible_to_supplier: doc.isVisibleToSupplier,
        is_required: doc.isRequired,
        status: doc.status,
        deadline: doc.deadline,
        file_url: doc.fileUrl,
        supplier_comment: doc.supplierComment
    };
    const { data, error } = await supabase.from('project_documents').insert(payload).select().single();
    if (error) handleError(error, 'addDocument');
    return mapProjectDocument(data);
};

/**
 * Update document metadata (title, description, visibility, deadline, etc.)
 */
export const updateDocumentMetadata = async (id: string, updates: Partial<ProjectDocument>): Promise<ProjectDocument> => {
    const payload: any = {};
    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.description = updates.description;
    if (updates.responsibleParty) payload.responsible_party = updates.responsibleParty;
    if (updates.isVisibleToSupplier !== undefined) payload.is_visible_to_supplier = updates.isVisibleToSupplier;
    if (updates.isRequired !== undefined) payload.is_required = updates.isRequired;
    if (updates.deadline) payload.deadline = updates.deadline;

    const { data, error } = await supabase.from('project_documents').update(payload).eq('id', id).select().single();
    if (error) handleError(error, 'updateDocumentMetadata');
    return mapProjectDocument(data);
};

/**
 * Update document status (not_started, waiting_upload, uploaded, under_review, approved, rejected)
 */
export const updateDocStatus = async (id: string, status: DocStatus, comment?: string): Promise<ProjectDocument> => {
    const updates: any = { status };
    if (comment) updates.supplier_comment = comment;
    const { data, error } = await supabase.from('project_documents').update(updates).eq('id', id).select().single();
    if (error) handleError(error, 'updateDocStatus');
    return mapProjectDocument(data);
};

/**
 * Delete a document
 */
export const removeDocument = async (id: string): Promise<void> => {
    await runMutation(supabase.from('project_documents').delete().eq('id', id), 'removeDocument');
};

/**
 * Upload/update file for a document and create version history
 */
export const uploadFile = async (docId: string, file: File, isSupplier: boolean): Promise<ProjectDocument> => {
    const ext = file.name.split('.').pop() || 'bin';
    const storagePath = `project-documents/${docId}/${Date.now()}.${ext}`;

    const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, { upsert: true, contentType: file.type });
    if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

    const { data: { publicUrl } } = supabase.storage.from('documents').getPublicUrl(storagePath);

    const updates: Record<string, unknown> = {
        file_url: publicUrl,
        status: isSupplier ? DocStatus.UPLOADED : DocStatus.APPROVED,
        uploaded_at: new Date().toISOString(),
    };
    // uploaded_by_supplier column has a DB default of false; only set explicitly when true
    if (isSupplier) updates.uploaded_by_supplier = true;

    const client = isSupplier ? portalClient : supabase;
    const { data, error } = await client.from('project_documents').update(updates).eq('id', docId).select().single();

    if (data) {
        await client.from('document_versions').insert({
            document_id: docId,
            file_url: publicUrl,
            version_number: (data.versions?.length || 0) + 1,
            uploaded_by_supplier: isSupplier,
            uploaded_at: new Date().toISOString()
        });
    }

    if (error) handleError(error, 'uploadFile');
    return mapProjectDocument(data);
};

/**
 * Upload a file ad-hoc, creating a new document if needed
 */
export const uploadAdHocFile = async (projectId: string, step_number: number, file: File, isSupplier: boolean): Promise<ProjectDocument> => {
    const doc = await addDocument({
        projectId,
        stepNumber: step_number,
        title: file.name,
        description: 'ad-hoc',
        responsibleParty: isSupplier ? ResponsibleParty.SUPPLIER : ResponsibleParty.INTERNAL,
        isVisibleToSupplier: true,
        isRequired: false,
        status: DocStatus.UPLOADED
    });
    return uploadFile(doc.id, file, isSupplier);
};

/**
 * Delete a specific document version
 */
export const deleteDocumentVersion = async (versionId: string): Promise<void> => {
    await runMutation(supabase.from('document_versions').delete().eq('id', versionId), 'deleteDocumentVersion');
};

/**
 * Add a comment to a document
 */
export const addDocumentComment = async (docId: string, content: string, authorName: string, authorRole: string): Promise<DocumentComment> => {
    const { data, error } = await supabase.from('document_comments').insert({
        document_id: docId,
        content,
        author_name: authorName,
        author_role: authorRole,
        created_at: new Date().toISOString()
    }).select().single();
    if (error) handleError(error, 'addComment');
    return {
        id: data.id,
        documentId: data.document_id,
        content: data.content,
        authorName: data.author_name,
        authorRole: data.author_role,
        createdAt: data.created_at
    };
};

/**
 * Get missing/pending documents for a supplier across all active projects
 */
export const getMissingDocumentsForSupplier = async (supplierId: string): Promise<(ProjectDocument & { projectName: string, projectIdCode: string })[]> => {
    if (!isLive) return [];
    const projects = await getProjectsBySupplierId(supplierId);
    const activeProjects = projects.filter(p => p.status !== ProjectOverallStatus.ARCHIVED && p.status !== ProjectOverallStatus.CANCELLED && p.status !== ProjectOverallStatus.COMPLETED);

    if (activeProjects.length === 0) return [];

    const projectIds = activeProjects.map(p => p.id);

    const { data: docs, error } = await portalClient.from('project_documents')
        .select('*')
        .in('project_id', projectIds)
        .eq('responsible_party', 'supplier')
        .neq('status', 'approved')
        .neq('status', 'uploaded');

    if (error) return [];

    const enriched = (docs || []).map(d => {
        const mappedDoc = mapProjectDocument(d);
        const proj = activeProjects.find(p => p.id === d.project_id);
        return {
            ...mappedDoc,
            projectName: proj?.name || 'Unknown Project',
            projectIdCode: proj?.projectId || ''
        };
    });

    return enriched;
};
