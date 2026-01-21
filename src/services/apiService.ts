
import { createClient } from '@supabase/supabase-js';
import { supabase as authenticatedClient, isLive } from './supabaseClient';
import { 
  Project, Supplier, User, ComplianceRequest, ComplianceRequestStatus, 
  CategoryL3, ProductFeature, ComplianceRequirement, ProjectStep, ProjectDocument, 
  DashboardStats, DocStatus, StepStatus, ResponsibleParty, UserRole, ProjectOverallStatus,
  ComplianceResponseItem, ChangeLogEntry, Notification, IMTemplate, IMSection, ProjectIM,
  DocumentComment, ProjectMilestones, IMTemplateMetadata,
  RFQ, RFQEntry, RFQStatus, RFQEntryStatus, CategoryAttribute, RFQAttributeValue, RFQAttachment,
  SupplierProposal, ProductionUpdate, DeadlineItem
} from '../types';

// Use environment-provided Supabase credentials (Netlify/Vite)
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY;

// The portal client is used for non-authenticated public routes
const portalClient = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-portal-auth-token'
  }
});

const supabase = authenticatedClient;

export const COMPLIANCE_SECTIONS = [
    'General Requirements',
    'Safety & Electrical',
    'Chemical & Material',
    'Mechanical & Physical',
    'Packaging & Labeling',
    'Performance & Testing'
];

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const handleError = (error: any, context: string) => {
  if (!isLive) {
      throw new Error(`Connection error: Supabase is not configured. Please check your environment variables in Netlify.`);
  }
  console.error(`Error in ${context}:`, error);
  let msg = 'Unknown error';
  
  if (typeof error === 'string') {
      msg = error;
  } else if (error instanceof Error) {
      msg = error.message;
      if (error.name === 'AbortError') msg = 'Connection aborted (AbortError). Please retry.';
  } else if (typeof error === 'object' && error !== null) {
      msg = error.message || error.error_description || error.details || (error.error && error.error.message);
      
      if (!msg) {
          try {
              msg = JSON.stringify(error);
          } catch (e) {
              msg = 'Non-serializable error object';
          }
      }
  } else {
      msg = String(error);
  }
  
  if (msg.includes('PGRST116')) msg = 'Record not found (PGRST116)';
  if (msg.includes('PGRST204')) msg = 'Columns not found (PGRST204)';
  
  throw new Error(`${msg}`);
};

// --- Mappers ---

const mapProfile = (p: any): User => {
  if (!p) throw new Error("Profile data is missing");
  return {
    id: p.id,
    email: p.email,
    name: p.name || 'User',
    role: (p.role || UserRole.PM).toUpperCase() as UserRole,
    avatarUrl: p.avatar_url
  };
};

const mapProject = (p: any): Project => {
  if (!p || typeof p !== 'object') throw new Error("Project data is missing or invalid");
  return {
    id: p.id,
    projectId: p.project_id_code || p.projectId, 
    name: p.name,
    supplierId: p.supplier_id,
    pmId: p.pm_id,
    currentStep: p.current_step,
    status: p.status,
    milestones: p.milestones,
    supplierLinkToken: p.supplier_link_token,
    createdAt: p.created_at
  };
};

const mapProjectStep = (s: any): ProjectStep => {
  if (!s || typeof s !== 'object') throw new Error("Step data is missing or invalid");
  return {
    id: s.id,
    projectId: s.project_id,
    stepNumber: s.step_number,
    name: s.name,
    status: s.status
  };
};

const mapProjectDocument = (d: any): ProjectDocument => {
  if (!d || typeof d !== 'object') throw new Error("Document data is missing or invalid");
  return {
    id: d.id,
    projectId: d.project_id,
    stepNumber: d.step_number,
    title: d.title,
    description: d.description,
    responsibleParty: d.responsible_party,
    isVisibleToSupplier: d.is_visible_to_supplier,
    isRequired: d.is_required,
    status: d.status,
    deadline: d.deadline,
    fileUrl: d.file_url,
    uploadedAt: d.uploaded_at,
    versions: d.versions || [],
    supplierComment: d.supplier_comment
  };
};

const mapSupplier = (s: any): Supplier => {
  if (!s || typeof s !== 'object') throw new Error("Supplier data is missing or invalid");
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    email: s.email,
    portalToken: s.portal_token || s.token 
  };
};

const mapComplianceRequest = (r: any): ComplianceRequest => {
  if (!r || typeof r !== 'object') throw new Error("Compliance request data is missing or invalid");
  return {
    id: r.id,
    requestId: r.request_id,
    projectId: r.project_id,
    projectName: r.project_name,
    supplierId: r.supplier_id,
    categoryId: r.category_id,
    features: Array.isArray(r.features) ? r.features : [],
    status: r.status,
    responses: Array.isArray(r.responses) ? r.responses : [],
    token: r.token,
    accessCode: r.access_code,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    completedAt: r.completed_at,
    updatedBy: r.updated_by,
    deadline: r.deadline,
    changeLog: r.change_log,
    respondentName: r.respondent_name,
    respondentPosition: r.respondent_position
  };
};

const mapProductionUpdate = (u: any): ProductionUpdate => {
    if (!u || typeof u !== 'object') throw new Error("Production update data is missing or invalid");
    return {
        id: u.id,
        projectId: u.project_id,
        previousEtd: u.previous_etd,
        newEtd: u.new_etd,
        isOnTime: u.is_on_time,
        delayReason: u.delay_reason,
        notes: u.notes,
        updatedBy: u.updated_by,
        isSupplierUpdate: u.is_supplier_update || u.is_supplier || false,
        createdAt: u.created_at
    };
};

const mapRFQ = (r: any): RFQ => {
  if (!r || typeof r !== 'object') throw new Error("RFQ data is missing or invalid");
  return {
    id: r.id,
    rfqId: r.rfq_id,
    title: r.title,
    categoryId: r.category_id,
    description: r.description,
    attributes: r.attributes || [],
    thumbnailUrl: r.thumbnail_url,
    attachments: r.attachments || [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    status: r.status,
    categoryName: r.category_l3?.name || r.category_name
  };
};

// --- Notifications & Edge Functions ---

export const triggerEmailNotification = async (payload: {
  to: string;
  subject: string;
  html: string;
  type: 'tcf_submission' | 'test' | 'rfq_invite';
}) => {
  console.info("Email notification suppressed per project settings.", payload.type);
  return { success: true, message: "Email suppressed" };
};

// --- Projects ---

export const getProjects = async (): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('projects').select('*');
    if (error) {
        console.error("getProjects failed", error);
        return []; 
    }
    return (data || []).map(mapProject);
};

export const getProjectById = async (id: string): Promise<Project | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapProject(data);
};

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

export const deleteProject = async (id: string): Promise<void> => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) handleError(error, 'deleteProject');
};

export const getProjectSteps = async (projectId: string): Promise<ProjectStep[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('project_steps').select('*').eq('project_id', projectId).order('step_number');
    if (error) return [];
    return (data || []).map(mapProjectStep);
};

export const updateStepStatus = async (stepId: string, status: StepStatus): Promise<void> => {
    await supabase.from('project_steps').update({ status }).eq('id', stepId);
};

export const getProjectDocs = async (projectId: string): Promise<ProjectDocument[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('project_documents').select('*').eq('project_id', projectId);
    if (error) return [];
    return (data || []).map(mapProjectDocument);
};

export const getProjectByToken = async (token: string): Promise<Project | undefined> => {
    if (!isLive) return undefined;
    const { data: rpcData, error: rpcError } = await portalClient.rpc('get_project_by_token_secure', { p_token: token });
    
    if (!rpcError && rpcData && rpcData.length > 0) {
        return mapProject(rpcData[0]);
    }
    return undefined;
};

export const getProjectsBySupplierId = async (supplierId: string): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('projects').select('*').eq('supplier_id', supplierId);
    if (error) return [];
    return (data || []).map(mapProject);
};

export const getProjectsBySupplierToken = async (token: string): Promise<Project[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.rpc('get_projects_by_supplier_token', { p_token: token });
    if (error) return [];
    return (data || []).map(mapProject);
};

export const saveProjectMilestones = async (projectId: string, milestones: ProjectMilestones): Promise<void> => {
    await updateProject(projectId, { milestones });
};

// --- Manufacturing / Production Updates ---

export const getProductionUpdates = async (projectId: string): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('production_updates')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(mapProductionUpdate);
};

export const getAllProductionUpdates = async (): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('production_updates')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) return [];
    return (data || []).map(mapProductionUpdate);
};

export const saveProductionUpdate = async (update: Partial<ProductionUpdate>): Promise<ProductionUpdate> => {
    if (!update.newEtd) {
        throw new Error("New ETD date is required");
    }

    const { data, error } = await portalClient.rpc('submit_production_update', {
        p_project_id: update.projectId,
        p_previous_etd: update.previousEtd || null,
        p_new_etd: update.newEtd,
        p_is_on_time: update.isOnTime,
        p_delay_reason: update.delayReason || null,
        p_notes: update.notes || null,
        p_updated_by: update.updatedBy,
        p_is_supplier: update.isSupplierUpdate || false
    });

    if (error) handleError(error, 'saveProductionUpdate');
    
    let record = data;
    if (Array.isArray(data)) {
        if (data.length === 0) throw new Error("Production update returned no data");
        record = data[0];
    }
    
    if (!record) {
        throw new Error("Failed to save production update: No data returned from server.");
    }
    
    return mapProductionUpdate(record);
};

// --- Suppliers ---

export const getSuppliers = async (): Promise<Supplier[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('suppliers').select('*');
    if (error) {
        console.error("getSuppliers failed", error);
        return [];
    }
    return (data || []).map(mapSupplier);
};

export const getSupplierById = async (id: string): Promise<Supplier | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('suppliers').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapSupplier(data);
};

export const createSupplier = async (name: string, code: string, email: string): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').insert({ name, code, email }).select().single();
    if (error) handleError(error, 'createSupplier');
    return mapSupplier(data);
};

export const updateSupplier = async (id: string, updates: Partial<Supplier>): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').update({
        name: updates.name,
        code: updates.code,
        email: updates.email
    }).eq('id', id).select().single();
    if (error) handleError(error, 'updateSupplier');
    return mapSupplier(data);
};

export const ensureSupplierToken = async (supplierId: string): Promise<string> => {
    const sup = await getSupplierById(supplierId);
    if (sup?.portalToken) return sup.portalToken;
    const token = generateUUID();
    await supabase.from('suppliers').update({ portal_token: token }).eq('id', supplierId);
    return token;
};

export const getSupplierByToken = async (token: string): Promise<Supplier | undefined> => {
    if (!isLive) return undefined;
    const { data, error } = await portalClient.from('suppliers').select('*').eq('portal_token', token).maybeSingle();
    if (error) return undefined;
    return data ? mapSupplier(data) : undefined;
};

// --- Users & Auth ---

export const getProfiles = async (): Promise<User[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) return [];
    return (data || []).map(mapProfile);
};

export const getUserProfile = async (userId: string): Promise<User | null> => {
    if (!isLive) return null;
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    
    if (!data) {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.id === userId) {
             const newProfile = {
                 id: userId,
                 email: userData.user.email || '',
                 name: userData.user.user_metadata?.name || 'User',
                 role: UserRole.PM
             };
             const { data: created, error: createError } = await supabase.from('profiles').insert(newProfile).select().single();
             if (createError) return null;
             return mapProfile(created);
        }
        return null;
    }
    return mapProfile(data);
};

export const getSessionUser = async (): Promise<User | null> => {
    if (!isLive) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return getUserProfile(session.user.id);
};

export const login = async (email: string, pass: string): Promise<User> => {
    if (!isLive) handleError(null, 'login');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) handleError(error, 'login');
    if (data.user) {
        const profile = await getUserProfile(data.user.id);
        if (profile) return profile;
        return mapProfile({ id: data.user.id, email: email, name: 'User', role: UserRole.PM });
    }
    throw new Error("Login failed");
};

export const signUp = async (email: string, pass: string, name: string): Promise<void> => {
    if (!isLive) handleError(null, 'signUp');
    const { data, error } = await supabase.auth.signUp({ 
        email, 
        password: pass,
        options: { data: { name } }
    });
    if (error) handleError(error, 'signUp');
};

export const logout = async (): Promise<void> => {
    await supabase.auth.signOut();
};

export const updateUserRole = async (userId: string, role: UserRole): Promise<void> => {
    await supabase.from('profiles').update({ role }).eq('id', userId);
};

// --- Documents ---

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

export const removeDocument = async (id: string): Promise<void> => {
    await supabase.from('project_documents').delete().eq('id', id);
};

export const updateDocStatus = async (id: string, status: DocStatus, comment?: string): Promise<ProjectDocument> => {
    const updates: any = { status };
    if (comment) updates.supplier_comment = comment;
    const { data, error } = await supabase.from('project_documents').update(updates).eq('id', id).select().single();
    if (error) handleError(error, 'updateDocStatus');
    return mapProjectDocument(data);
};

export const uploadFile = async (docId: string, file: File, isSupplier: boolean): Promise<ProjectDocument> => {
    const mockUrl = `https://fake-storage.com/${file.name}`;
    const updates = {
        file_url: mockUrl,
        status: isSupplier ? DocStatus.UPLOADED : DocStatus.APPROVED,
        uploaded_at: new Date().toISOString(),
        uploaded_by_supplier: isSupplier
    };
    
    const client = isSupplier ? portalClient : supabase;
    const { data, error } = await client.from('project_documents').update(updates).eq('id', docId).select().single();
    
    if (data) {
        await client.from('document_versions').insert({
            document_id: docId,
            file_url: mockUrl,
            version_number: (data.versions?.length || 0) + 1,
            uploaded_by_supplier: isSupplier,
            uploaded_at: new Date().toISOString()
        });
    }

    if (error) handleError(error, 'uploadFile');
    return mapProjectDocument(data);
};

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

export const deleteDocumentVersion = async (versionId: string): Promise<void> => {
    await supabase.from('document_versions').delete().eq('id', versionId);
};

export const getDocumentComments = async (docId: string): Promise<DocumentComment[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('document_comments').select('*').eq('document_id', docId).order('created_at');
    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        documentId: c.document_id,
        content: c.content,
        authorName: c.author_name,
        authorRole: c.author_role,
        createdAt: c.created_at
    }));
};

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

    return enriched.sort((a, b) => {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
};

// --- Stats & Notifications ---

export const getDashboardStats = async (): Promise<DashboardStats & { newProposals: number }> => {
    if (!isLive) return { activeProjects: 0, pendingReviews: 0, overdueCount: 0, upcomingDeadlines: [], newProposals: 0 } as any;
    
    const today = new Date();
    const nextPeriod = new Date();
    nextPeriod.setDate(today.getDate() + 14);

    const [projectsRes, docsRes, proposalsRes, tcfRes] = await Promise.all([
        supabase.from('projects').select('status'),
        supabase.from('project_documents').select('*, projects!inner(name)').eq('status', 'uploaded'),
        supabase.from('supplier_proposals').select('id').eq('status', 'new'),
        supabase.from('compliance_requests').select('*, projects!inner(name)').eq('status', 'pending_supplier')
    ]);

    const projects = projectsRes.data || [];
    const activeProjects = projects.filter(p => p.status === ProjectOverallStatus.IN_PROGRESS).length;
    const pendingReviews = (docsRes.data || []).length;
    const newProposals = (proposalsRes.data || []).length;
    
    // Fetch all docs with deadlines
    const { data: deadlineDocs } = await supabase.from('project_documents')
        .select('*, projects!inner(name)')
        .not('deadline', 'is', null)
        .neq('status', 'approved')
        .lte('deadline', nextPeriod.toISOString())
        .order('deadline');

    // Fetch all TCF requests with deadlines
    const tcfDeadlines = (tcfRes.data || []).filter(r => r.deadline).map(r => {
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

    const docDeadlines = (deadlineDocs || []).map((d: any) => {
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
    } as any;
};

export const getSupplierNotifications = async (supplierId: string): Promise<Notification[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('notifications').select('*').eq('supplier_id', supplierId);
    if (error) return [];
    return (data || []).map((n: any) => ({
        id: n.id,
        userId: n.user_id,
        message: n.message,
        link: n.link,
        isRead: n.is_read,
        createdAt: n.created_at
    }));
};

export const getNotifications = async (): Promise<Notification[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map((n: any) => ({
        id: n.id,
        userId: n.user_id,
        message: n.message,
        link: n.link,
        isRead: n.is_read,
        createdAt: n.created_at
    }));
};

export const markNotificationRead = async (id: string): Promise<void> => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
};

// --- Compliance ---

export const getComplianceRequests = async (): Promise<ComplianceRequest[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase.from('compliance_requests').select('*').order('created_at', { ascending: false });
  if (error) return [];
  return (data || []).map(mapComplianceRequest);
};

export const getComplianceRequestById = async (id: string): Promise<ComplianceRequest | undefined> => {
  if (!id || !isLive) return undefined;
  const { data, error } = await supabase.from('compliance_requests').select('*').eq('id', id).single();
  if (error) return undefined;
  return mapComplianceRequest(data);
};

export const createComplianceRequest = async (
  projectId: string, projectName: string, requestIdCode: string, supplierId: string, 
  categoryId: string, features: { featureId: string; value: boolean }[], deadline?: string
): Promise<ComplianceRequest> => {
  const token = generateUUID();
  const accessCode = Math.floor(100000 + Math.random() * 900000).toString();
  
  const { data, error } = await supabase.from('compliance_requests').insert({
    project_id: projectId || null,
    project_name: projectName,
    request_id: requestIdCode,
    supplier_id: supplierId,
    category_id: categoryId,
    features,
    status: ComplianceRequestStatus.PENDING_SUPPLIER,
    token,
    access_code: accessCode,
    deadline: deadline || null,
    created_at: new Date().toISOString()
  }).select().single();
  if (error) handleError(error, 'create compliance req');
  return mapComplianceRequest(data);
};

export const getComplianceRequestByToken = async (token: string): Promise<ComplianceRequest | undefined> => {
    if (!isLive) return undefined;
    const { data, error } = await portalClient.from('compliance_requests').select('*').eq('token', token).maybeSingle();
    if (error) return undefined;
    if (!data) return undefined;
    return mapComplianceRequest(data);
};

export const verifySupplierAccess = async (token: string, accessCode: string): Promise<ComplianceRequest> => {
    if (!isLive) throw new Error("Connection error: Supabase is not configured.");
    const { data, error } = await portalClient.rpc('get_compliance_request_secure', { 
        p_token: token, 
        p_code: accessCode 
    });
    
    if (error) handleError(error, 'verify access');
    if (!data || data.length === 0) throw new Error('Invalid credentials');
    
    return mapComplianceRequest(data[0]);
};

export const submitComplianceResponseSecure = async (
    token: string, 
    accessCode: string,
    responses: ComplianceResponseItem[], 
    status: ComplianceRequestStatus,
    respondentName: string,
    respondentPosition: string
): Promise<void> => {
    const { error } = await portalClient.rpc('submit_compliance_response_secure', {
        p_token: token,
        p_code: accessCode,
        p_responses: responses,
        p_status: status,
        p_respondent_name: respondentName,
        p_respondent_position: respondentPosition
    });
    
    if (error) handleError(error, 'submit response');
};

export const submitComplianceResponse = async (reqId: string, responses: ComplianceResponseItem[], status?: ComplianceRequestStatus, user?: string): Promise<void> => {
    const updates: any = { responses, submitted_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (status === ComplianceRequestStatus.APPROVED) updates.completed_at = new Date().toISOString();
    if (user) updates.updated_by = user;
    
    await supabase.from('compliance_requests').update(updates).eq('id', reqId);
};

export const deleteComplianceRequest = async (id: string): Promise<void> => {
    await supabase.from('compliance_requests').delete().eq('id', id);
};

export const getComplianceRequestsBySupplierId = async (supplierId: string): Promise<ComplianceRequest[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('compliance_requests').select('*').eq('supplier_id', supplierId);
    if (error) return [];
    return (data || []).map(mapComplianceRequest);
};

export const checkComplianceDeadlines = async (): Promise<void> => {
};

export const getCategories = async (): Promise<CategoryL3[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('categories_l3').select('*');
    if (error) return [];
    return (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        isFinalized: c.is_finalized,
        finalizedAt: c.finalized_at
    }));
};

export const saveCategory = async (cat: CategoryL3): Promise<void> => {
    const payload = {
        id: cat.id,
        name: cat.name,
        active: cat.active,
        is_finalized: cat.isFinalized,
        finalized_at: cat.finalizedAt
    };
    const { error } = await supabase.from('categories_l3').upsert(payload);
    if (error) handleError(error, 'saveCategory');
};

export const createCategory = async (name: string): Promise<CategoryL3> => {
    const newCat = { id: generateUUID(), name, active: true, isFinalized: false };
    await saveCategory(newCat);
    return newCat;
};

export const deleteCategory = async (id: string): Promise<void> => {
    await supabase.from('categories_l3').delete().eq('id', id);
};

export const getProductFeatures = async (): Promise<ProductFeature[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('product_features').select('*');
    if (error) return [];
    return (data || []).map((f: any) => ({
        id: f.id,
        categoryId: f.category_id,
        name: f.name,
        active: f.active
    }));
};

export const saveProductFeature = async (feat: ProductFeature): Promise<void> => {
    const payload: any = { 
        id: feat.id,
        name: feat.name,
        active: feat.active
    };
    if (feat.categoryId) {
        payload.category_id = feat.categoryId;
    }
    const { error } = await supabase.from('product_features').upsert(payload);
    if (error) handleError(error, 'saveFeature');
};

export const deleteProductFeature = async (id: string): Promise<void> => {
    await supabase.from('product_features').delete().eq('id', id);
};

export const getCategoryAttributes = async (): Promise<CategoryAttribute[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('category_attributes').select('*');
    if (error) return [];
    return (data || []).map((a: any) => ({
        id: a.id,
        categoryId: a.category_id,
        name: a.name,
        dataType: a.dataType
    }));
};

export const saveCategoryAttribute = async (attr: CategoryAttribute): Promise<void> => {
    const payload = {
        id: attr.id,
        category_id: attr.categoryId,
        name: attr.name,
        dataType: attr.dataType
    };
    const { error } = await supabase.from('category_attributes').upsert(payload);
    if (error) handleError(error, 'saveCategoryAttribute');
};

export const deleteCategoryAttribute = async (id: string): Promise<void> => {
    await supabase.from('category_attributes').delete().eq('id', id);
};

export const getComplianceRequirements = async (): Promise<ComplianceRequirement[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('compliance_requirements').select('*');
    if (error) return [];
    return (data || []).map((r: any) => ({
        ...r,
        categoryId: r.category_id,
        conditionFeatureIds: r.condition_feature_ids,
        referenceCode: r.reference_code,
        isMandatory: r.is_mandatory,
        appliesByDefault: r.applies_by_default,
        timingType: r.timing_type,
        timingWeeks: r.timing_weeks,
        selfDeclarationAccepted: r.self_declaration_accepted,
        testReportOrigin: r.test_report_origin
    }));
};

export const saveRequirement = async (req: ComplianceRequirement): Promise<void> => {
    const payload: any = {
        id: req.id,
        category_id: req.categoryId,
        section: req.section,
        title: req.title,
        description: req.description,
        is_mandatory: req.isMandatory, 
        reference_code: req.referenceCode,
        applies_by_default: req.appliesByDefault,
        condition_feature_ids: req.conditionFeatureIds,
        timing_type: req.timingType,
        timing_weeks: req.timingWeeks,
        self_declaration_accepted: req.selfDeclarationAccepted,
        test_report_origin: req.testReportOrigin
    };
    const { error } = await supabase.from('compliance_requirements').upsert(payload);
    if (error) handleError(error, 'saveRequirement');
};

export const deleteRequirement = async (id: string): Promise<void> => {
    await supabase.from('compliance_requirements').delete().eq('id', id);
};

export const addStandardRequirements = async (categoryId: string): Promise<void> => {
    const defaults: ComplianceRequirement[] = [
        { id: generateUUID(), categoryId, title: "LVD Report", description: "Low Voltage Directive Compliance", isMandatory: true, appliesByDefault: true, conditionFeatureIds: [] },
        { id: generateUUID(), categoryId, title: "EMC Report", description: "Electromagnetic Compatibility", isMandatory: true, appliesByDefault: true, conditionFeatureIds: [] }
    ];
    for (const d of defaults) await saveRequirement(d);
};

// --- IM Templates ---

export const getIMTemplates = async (): Promise<IMTemplate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('im_templates').select('*');
    if (error) return [];
    return (data || []).map((t: any) => ({
      id: t.id,
      categoryId: t.category_id,
      name: t.name,
      languages: t.languages,
      isFinalized: t.is_finalized,
      finalizedAt: t.finalized_at,
      metadata: t.metadata,
      updatedAt: t.updated_at,
      lastUpdatedBy: t.last_updated_by
    }));
};

export const getIMTemplateById = async (id: string): Promise<IMTemplate | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await portalClient.from('im_templates').select('*').eq('id', id).single();
    if (error) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

export const getIMTemplateByCategoryId = async (categoryId: string): Promise<IMTemplate | undefined> => {
    if (!categoryId || !isLive) return undefined;
    const { data, error } = await supabase.from('im_templates').select('*').eq('category_id', categoryId).single();
    if (error) return undefined;
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

export const createIMTemplate = async (categoryId: string, name: string): Promise<IMTemplate> => {
    const { data, error } = await supabase.from('im_templates').insert({
        id: generateUUID(),
        category_id: categoryId,
        name,
        languages: ['en'],
        is_finalized: false,
        updated_at: new Date().toISOString()
    }).select().single();
    if (error) handleError(error, 'createIMTemplate');
    return {
      id: data.id,
      categoryId: data.category_id,
      name: data.name,
      languages: data.languages,
      isFinalized: data.is_finalized,
      finalizedAt: data.finalized_at,
      metadata: data.metadata,
      updatedAt: data.updated_at,
      lastUpdatedBy: data.last_updated_by
    };
};

export const updateIMTemplate = async (id: string, updates: Partial<IMTemplate>): Promise<void> => {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.metadata !== undefined) payload.metadata = updates.metadata;
    if (updates.languages !== undefined) payload.languages = updates.languages;
    if (updates.lastUpdatedBy !== undefined) payload.last_updated_by = updates.lastUpdatedBy;
    if (updates.categoryId !== undefined) payload.category_id = updates.categoryId;
    if (updates.isFinalized !== undefined) payload.is_finalized = updates.isFinalized;
    if (updates.finalizedAt !== undefined) payload.finalized_at = updates.finalizedAt;
    
    payload.updated_at = new Date().toISOString();

    await supabase.from('im_templates').update(payload).eq('id', id);
};

export const getIMSections = async (templateId: string): Promise<IMSection[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('im_sections').select('*').eq('template_id', templateId);
    if (error) return [];
    return (data || []).map((s: any) => ({
      id: s.id,
      templateId: s.template_id,
      parentId: s.parent_id,
      title: s.title,
      order: s.order,
      isPlaceholder: s.is_placeholder,
      content: s.content
    }));
};

export const saveIMSection = async (section: Partial<IMSection>): Promise<IMSection> => {
    const payload: any = {
        title: section.title,
        order: section.order,
        content: section.content
    };
    
    if (section.id) payload.id = section.id;
    else payload.id = generateUUID();

    if (section.templateId) payload.template_id = section.templateId;
    if (section.parentId) payload.parent_id = section.parentId;
    if (section.isPlaceholder !== undefined) payload.is_placeholder = section.isPlaceholder;

    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    const { data, error } = await supabase.from('im_sections').upsert(payload).select().single();
    if (error) handleError(error, 'saveIMSection');
    return {
      id: data.id,
      templateId: data.template_id,
      parentId: data.parent_id,
      title: data.title,
      order: data.order,
      isPlaceholder: data.is_placeholder,
      content: data.content
    };
};

export const deleteIMSection = async (id: string): Promise<void> => {
    await supabase.from('im_sections').delete().eq('id', id);
};

export const getProjectIM = async (projectId: string): Promise<ProjectIM | null> => {
    if (!isLive) return null;
    const { data, error } = await supabase.from('project_ims').select('*').eq('project_id', projectId).maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
      id: data.id,
      templateId: data.template_id,
      placeholderData: data.placeholder_data,
      status: data.status,
      updatedAt: data.updated_at
    };
};

export const saveProjectIM = async (projectId: string, templateId: string, placeholderData: Record<string, string>, status: 'draft' | 'generated'): Promise<ProjectIM> => {
    const { data: existing } = await supabase.from('project_ims').select('id').eq('project_id', projectId).maybeSingle();
    
    const payload = {
        project_id: projectId, 
        template_id: templateId, 
        placeholder_data: placeholderData, 
        status, 
        updated_at: new Date().toISOString()
    };

    if (existing) {
        const { data, error } = await supabase.from('project_ims').update(payload).eq('id', existing.id).select().single();
        if (error) handleError(error, 'saveProjectIM update');
        return {
          id: data.id,
          templateId: data.template_id,
          placeholderData: data.placeholder_data,
          status: data.status,
          updatedAt: data.updated_at
        };
    } else {
        const { data, error } = await supabase.from('project_ims').insert(payload).select().single();
        if (error) handleError(error, 'saveProjectIM insert');
        return {
          id: data.id,
          templateId: data.template_id,
          placeholderData: data.placeholder_data,
          status: data.status,
          updatedAt: data.updated_at
        };
    }
};

export const deleteProjectIM = async (projectId: string): Promise<void> => {
    await supabase.from('project_ims').delete().eq('id', projectId);
};

// --- SOURCING / RFQ ---

export const getRFQs = async (): Promise<RFQ[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('rfqs').select('*, category_l3:categories_l3(name)').order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(mapRFQ);
};

export const getRFQsForSupplier = async (supplierId: string): Promise<RFQEntry[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('rfq_entries')
        .select('*, rfqs!inner(*)')
        .eq('supplier_id', supplierId)
        .eq('rfqs.status', 'open');
        
    if (error) return [];
    
    return (data || []).map((e: any) => ({
      id: e.id,
      rfqId: e.rfq_id,
      supplierId: e.supplier_id,
      token: e.token,
      status: e.status,
      unitPrice: e.unit_price,
      moq: e.moq,
      leadTimeWeeks: e.lead_time_weeks,
      tooling_cost: e.tooling_cost,
      currency: e.currency,
      supplierNotes: e.supplier_notes,
      quoteFileUrl: e.quote_file_url,
      submittedAt: e.submitted_at,
      createdAt: e.created_at,
      supplierName: e.supplier?.name,
      rfqTitle: e.rfqs?.title,
      rfqIdentifier: e.rfqs?.rfq_id
    }));
};

export const getRFQById = async (id: string): Promise<RFQ | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('rfqs').select('*, category_l3:categories_l3(name)').eq('id', id).single();
    if (error) return undefined;
    
    const rfq = mapRFQ(data);
    const { data: entries } = await supabase.from('rfq_entries').select('*, supplier:suppliers(name)').eq('rfq_id', id);
    if (entries) {
        rfq.entries = entries.map((e: any) => ({
          id: e.id,
          rfqId: e.rfq_id,
          supplierId: e.supplier_id,
          token: e.token,
          status: e.status,
          unitPrice: e.unit_price,
          moq: e.moq,
          leadTimeWeeks: e.lead_time_weeks,
          toolingCost: e.tooling_cost,
          currency: e.currency,
          supplierNotes: e.supplier_notes,
          quoteFileUrl: e.quote_file_url,
          submittedAt: e.submitted_at,
          createdAt: e.created_at,
          supplierName: e.supplier?.name,
          rfqTitle: e.rfqs?.title,
          rfqIdentifier: e.rfqs?.rfq_id
        }));
    }
    return rfq;
};

export const createRFQ = async (
    title: string, 
    rfqId: string, 
    description: string, 
    supplierIds: string[], 
    createdBy: string, 
    categoryId?: string, 
    attributes?: RFQAttributeValue[],
    thumbnailUrl?: string,
    attachments?: RFQAttachment[]
): Promise<RFQ> => {
    const { data: rfqData, error } = await supabase.from('rfqs').insert({
        title, 
        rfq_id: rfqId, 
        description, 
        created_by: createdBy,
        category_id: categoryId || null, 
        attributes: attributes, 
        thumbnail_url: thumbnailUrl,
        attachments: attachments, 
        status: RFQStatus.OPEN,
        created_at: new Date().toISOString()
    }).select().single();
    
    if (error) handleError(error, 'createRFQ');
    
    const newRFQ = mapRFQ(rfqData);

    if (supplierIds.length > 0) {
        const entriesPayload = supplierIds.map(sid => ({
            rfq_id: newRFQ.id,
            supplier_id: sid,
            token: generateUUID(),
            status: RFQEntryStatus.PENDING,
            created_at: new Date().toISOString()
        }));
        
        const { error: entriesError } = await supabase.from('rfq_entries').insert(entriesPayload);
        if (entriesError) console.error("Failed to create RFQ entries", entriesError);
    }

    return newRFQ;
};

export const deleteRFQ = async (id: string): Promise<void> => {
    const { error } = await supabase.from('rfqs').delete().eq('id', id);
    if (error) handleError(error, 'deleteRFQ');
};

export const getRFQEntryByToken = async (token: string): Promise<{ rfq: RFQ, entry: RFQEntry } | undefined> => {
    if (!isLive) return undefined;
    const { data: entryData, error } = await portalClient.from('rfq_entries').select('*').eq('token', token).maybeSingle();
    if (error || !entryData) {
        console.error("getRFQEntryByToken: Entry not found or error", error);
        return undefined;
    }
    
    const entry: RFQEntry = {
      id: entryData.id,
      rfqId: entryData.rfq_id,
      supplierId: entryData.supplier_id,
      token: entryData.token,
      status: entryData.status,
      unitPrice: entryData.unit_price,
      moq: entryData.moq,
      leadTimeWeeks: entryData.lead_time_weeks,
      toolingCost: entryData.tooling_cost,
      currency: entryData.currency,
      supplierNotes: entryData.supplier_notes,
      quoteFileUrl: entryData.quote_file_url,
      submittedAt: entryData.submitted_at,
      createdAt: entryData.created_at,
      supplierName: entryData.supplier?.name,
      rfqTitle: entryData.rfqs?.title,
      rfqIdentifier: entryData.rfqs?.rfq_id
    };
    
    let { data: rfqData, error: rfqError } = await portalClient.from('rfqs').select('*, category_l3:categories_l3(name)').eq('id', entry.rfqId).maybeSingle();
    
    if (rfqError || !rfqData) {
        const { data: retryData } = await portalClient.from('rfqs').select('*').eq('id', entry.rfqId).maybeSingle();
        rfqData = retryData;
    }
    
    if (!rfqData) return undefined;
    
    return { rfq: mapRFQ(rfqData), entry };
};

export const submitRFQEntry = async (entryId: string, data: Partial<RFQEntry>): Promise<void> => {
    const payload: any = {
        status: RFQEntryStatus.SUBMITTED,
        submitted_at: new Date().toISOString(),
        unit_price: data.unitPrice,
        moq: data.moq,
        lead_time_weeks: data.leadTimeWeeks,
        tooling_cost: data.toolingCost,
        supplier_notes: data.supplierNotes,
        quote_file_url: data.quoteFileUrl
    };
    
    const { error } = await portalClient.from('rfq_entries').update(payload).eq('id', entryId);
    if (error) handleError(error, 'submitRFQEntry');
};

export const awardRFQ = async (rfqId: string, entryId: string): Promise<void> => {
    const { error: entryError } = await supabase.from('rfq_entries').update({ status: RFQEntryStatus.AWARDED }).eq('id', entryId);
    if (entryError) handleError(entryError, 'awardRFQ (entry)');

    const { error: rfqError } = await supabase.from('rfqs').update({ status: RFQStatus.AWARDED }).eq('id', rfqId);
    if (rfqError) handleError(rfqError, 'awardRFQ (rfq)');
};

// --- SUPPLIER PROPOSALS ---

export const getAllSupplierProposals = async (): Promise<SupplierProposal[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('supplier_proposals').select('*, supplier:suppliers(name)').order('created_at', { ascending: false });
    if (error) handleError(error, 'getAllSupplierProposals');
    return (data || []).map((p: any) => ({
        id: p.id,
        supplierId: p.supplier_id,
        supplierName: p.supplier?.name,
        title: p.title,
        description: p.description,
        fileUrl: p.file_url,
        status: p.status,
        createdAt: p.created_at
    }));
};

export const getSupplierProposals = async (supplierId: string): Promise<SupplierProposal[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('supplier_proposals').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map((p: any) => ({
        id: p.id,
        supplierId: p.supplier_id,
        supplierName: p.supplier?.name,
        title: p.title,
        description: p.description,
        fileUrl: p.file_url,
        status: p.status,
        createdAt: p.created_at
    }));
};

export const createSupplierProposal = async (supplierId: string, title: string, description: string, fileUrl: string): Promise<void> => {
    const { error } = await portalClient.from('supplier_proposals').insert({
        supplier_id: supplierId,
        title,
        description,
        file_url: fileUrl,
        status: 'new',
        created_at: new Date().toISOString()
    });
    if (error) handleError(error, 'createSupplierProposal');
};
