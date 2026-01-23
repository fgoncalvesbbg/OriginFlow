/**
 * Data mapper utilities for transforming database responses to domain types
 * Centralizes data transformation logic to ensure consistency across the application
 */

import {
  User, Project, ProjectStep, ProjectDocument, Supplier, ComplianceRequest,
  ProductionUpdate, RFQ, UserRole
} from '../types';

/**
 * Maps database profile row to User domain type
 */
export const mapProfile = (p: any): User => {
  if (!p) throw new Error("Profile data is missing");
  return {
    id: p.id,
    email: p.email,
    name: p.name || 'User',
    role: (p.role || UserRole.PM).toUpperCase() as UserRole,
    avatarUrl: p.avatar_url
  };
};

/**
 * Maps database project row to Project domain type
 */
export const mapProject = (p: any): Project => {
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

/**
 * Maps database project_step row to ProjectStep domain type
 */
export const mapProjectStep = (s: any): ProjectStep => {
  if (!s || typeof s !== 'object') throw new Error("Step data is missing or invalid");
  return {
    id: s.id,
    projectId: s.project_id,
    stepNumber: s.step_number,
    name: s.name,
    status: s.status
  };
};

/**
 * Maps database project_document row to ProjectDocument domain type
 */
export const mapProjectDocument = (d: any): ProjectDocument => {
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

/**
 * Maps database supplier row to Supplier domain type
 */
export const mapSupplier = (s: any): Supplier => {
  if (!s || typeof s !== 'object') throw new Error("Supplier data is missing or invalid");
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    email: s.email,
    portalToken: s.portal_token || s.token
  };
};

/**
 * Maps database compliance_request row to ComplianceRequest domain type
 */
export const mapComplianceRequest = (r: any): ComplianceRequest => {
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

/**
 * Maps database production_update row to ProductionUpdate domain type
 */
export const mapProductionUpdate = (u: any): ProductionUpdate => {
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

/**
 * Maps database rfq row to RFQ domain type
 */
export const mapRFQ = (r: any): RFQ => {
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
