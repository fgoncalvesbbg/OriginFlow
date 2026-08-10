/**
 * Project document service
 * Manages project documents, file uploads, versions, and comments
 */

import { db, portalDb, storage, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectDocument, DocVersion, DocStatus, ResponsibleParty, DocumentComment, ProjectOverallStatus } from '../../types';
import { mapProjectDocument, mapDocVersion } from '../../utils/mappers.utils';
import { validateUploadFile, safeExtension } from '../../utils/upload-validation.utils';
import { getProjectsBySupplierId } from './project.service';

const BUCKET = 'documents';

/**
 * Get all documents for a project
 */
export const getProjectDocs = async (projectId: string): Promise<ProjectDocument[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('project_documents', { where: { project_id: projectId } }),
        'getProjectDocs',
    );
    const docs = rows.map(mapProjectDocument);

    // Attach version history in one extra query. Best-effort: a failure here (missing
    // table / permissions) must never drop the documents list, so versions just stay empty.
    const ids = docs.map(d => d.id);
    if (ids.length) {
        const versionRows = await orEmpty(
            db.select<Row>('document_versions', { where: { document_id: ids } }),
            'getProjectDocs:versions',
        );
        const byDoc = new Map<string, DocVersion[]>();
        for (const row of versionRows) {
            const list = byDoc.get(row.document_id) ?? [];
            list.push(mapDocVersion(row));
            byDoc.set(row.document_id, list);
        }
        for (const d of docs) {
            d.versions = (byDoc.get(d.id) ?? []).sort((a, b) => a.versionNumber - b.versionNumber);
        }
    }
    return docs;
};

/**
 * Add a new document to a project
 */
export const addDocument = async (doc: Omit<ProjectDocument, 'id'>): Promise<ProjectDocument> => {
    const created = await db.insert<Row>('project_documents', {
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
    });
    return mapProjectDocument(created);
};

/**
 * Update document metadata (title, description, visibility, deadline, etc.)
 */
export const updateDocumentMetadata = async (id: string, updates: Partial<ProjectDocument>): Promise<ProjectDocument> => {
    const payload: Row = {};
    if (updates.title) payload.title = updates.title;
    if (updates.description) payload.description = updates.description;
    if (updates.responsibleParty) payload.responsible_party = updates.responsibleParty;
    if (updates.isVisibleToSupplier !== undefined) payload.is_visible_to_supplier = updates.isVisibleToSupplier;
    if (updates.isRequired !== undefined) payload.is_required = updates.isRequired;
    if (updates.deadline) payload.deadline = updates.deadline;

    const updated = await db.update<Row>('project_documents', payload, { where: { id } });
    return mapProjectDocument(updated);
};

/**
 * Update document status (not_started, waiting_upload, uploaded, under_review, approved, rejected)
 */
export const updateDocStatus = async (id: string, status: DocStatus, comment?: string): Promise<ProjectDocument> => {
    const updates: Row = { status };
    if (comment) updates.supplier_comment = comment;
    const updated = await db.update<Row>('project_documents', updates, { where: { id } });
    return mapProjectDocument(updated);
};

/**
 * Delete a document
 */
export const removeDocument = async (id: string): Promise<void> => {
    await db.delete('project_documents', { where: { id } });
};

/**
 * Upload/update file for a document and create version history.
 *
 * Supplier uploads (isSupplier=true) go through the SECURITY DEFINER routine
 * supplier_set_document_file, which validates that the document belongs to the
 * project addressed by `projectToken` (projects.supplier_link_token). Anon no
 * longer writes project_documents directly. PM uploads keep using the
 * authenticated client and record version history.
 */
export const uploadFile = async (docId: string, file: File, isSupplier: boolean, projectToken?: string): Promise<ProjectDocument> => {
    validateUploadFile(file);
    const ext = safeExtension(file.name);
    const storagePath = `project-documents/${docId}/${Date.now()}.${ext}`;

    await storage.upload(BUCKET, storagePath, file, { upsert: true, contentType: file.type });
    const publicUrl = storage.publicUrl(BUCKET, storagePath);

    if (isSupplier) {
        if (!projectToken) throw new Error('uploadFile: projectToken is required for supplier uploads');
        const data = await portalDb.rpc<Row | Row[]>('supplier_set_document_file', {
            p_project_token: projectToken,
            p_doc_id: docId,
            p_file_url: publicUrl,
        });
        const row = Array.isArray(data) ? data[0] : data;
        return mapProjectDocument(row);
    }

    const updated = await db.update<Row>(
        'project_documents',
        {
            file_url: publicUrl,
            status: DocStatus.APPROVED,
            uploaded_at: new Date().toISOString(),
        },
        { where: { id: docId } },
    );

    // Sequential version number = (existing versions for this doc) + 1. The updated
    // row doesn't carry its versions, so count them directly.
    const count = await db.count('document_versions', { where: { document_id: docId } });
    await db.insertMany('document_versions', [{
        document_id: docId,
        file_url: publicUrl,
        version_number: count + 1,
        uploaded_by_supplier: false,
        uploaded_at: new Date().toISOString()
    }]);

    return mapProjectDocument(updated);
};

/**
 * Upload a file ad-hoc, creating a new document if needed.
 *
 * Supplier uploads create the document via the supplier_add_adhoc_document routine
 * (token-scoped); PM uploads create it with the authenticated client.
 */
export const uploadAdHocFile = async (projectId: string, step_number: number, file: File, isSupplier: boolean, projectToken?: string): Promise<ProjectDocument> => {
    if (isSupplier) {
        if (!projectToken) throw new Error('uploadAdHocFile: projectToken is required for supplier uploads');
        validateUploadFile(file);
        const ext = safeExtension(file.name);
        const storagePath = `project-documents/adhoc/${Date.now()}.${ext}`;
        await storage.upload(BUCKET, storagePath, file, { upsert: true, contentType: file.type });
        const publicUrl = storage.publicUrl(BUCKET, storagePath);

        const data = await portalDb.rpc<Row | Row[]>('supplier_add_adhoc_document', {
            p_project_token: projectToken,
            p_step_number: step_number,
            p_title: file.name,
            p_file_url: publicUrl,
        });
        const row = Array.isArray(data) ? data[0] : data;
        return mapProjectDocument(row);
    }

    const doc = await addDocument({
        projectId,
        stepNumber: step_number,
        title: file.name,
        description: 'ad-hoc',
        responsibleParty: ResponsibleParty.INTERNAL,
        isVisibleToSupplier: true,
        isRequired: false,
        status: DocStatus.UPLOADED
    });
    return uploadFile(doc.id, file, false);
};

/**
 * Delete a specific document version
 */
export const deleteDocumentVersion = async (versionId: string): Promise<void> => {
    await db.delete('document_versions', { where: { id: versionId } });
};

/**
 * Add a comment to a document
 */
export const addDocumentComment = async (docId: string, content: string, authorName: string, authorRole: string): Promise<DocumentComment> => {
    const data = await db.insert<Row>('document_comments', {
        document_id: docId,
        content,
        author_name: authorName,
        author_role: authorRole,
        created_at: new Date().toISOString()
    });
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
 * Add a supplier comment to a document from the portal, authorized by the
 * supplier's portal token + access code. Uses the SECURITY DEFINER routine so anon
 * can no longer insert/spoof comments directly.
 */
export const addSupplierDocumentComment = async (
    supplierToken: string,
    accessCode: string,
    docId: string,
    content: string,
    authorName: string
): Promise<DocumentComment> => {
    const data = await portalDb.rpc<Row | Row[]>('supplier_add_document_comment', {
        p_supplier_token: supplierToken,
        p_code: accessCode,
        p_doc_id: docId,
        p_content: content,
        p_author_name: authorName,
    });
    const row = Array.isArray(data) ? data[0] : data;
    return {
        id: row.id,
        documentId: row.document_id,
        content: row.content,
        authorName: row.author_name,
        authorRole: row.author_role,
        createdAt: row.created_at
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

    const docs = await orEmpty(
        portalDb.select<Row>('project_documents', {
            where: {
                project_id: projectIds,
                responsible_party: 'supplier',
                // Two comparisons on one column: neither 'approved' nor 'uploaded'.
                status: [{ op: 'neq', value: 'approved' }, { op: 'neq', value: 'uploaded' }],
            },
        }),
        'getMissingDocumentsForSupplier',
    );

    return docs.map(d => {
        const mappedDoc = mapProjectDocument(d);
        const proj = activeProjects.find(p => p.id === d.project_id);
        return {
            ...mappedDoc,
            projectName: proj?.name || 'Unknown Project',
            projectIdCode: proj?.projectId || ''
        };
    });
};
