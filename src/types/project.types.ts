/**
 * Project module types
 */

export enum ProjectOverallStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
  ARCHIVED = 'archived'
}

export interface ProjectMilestones {
    poPlacement?: string;
    massProduction?: string;
    etd?: string;
    eta?: string;
}

export interface Project {
  id: string;
  projectId: string;
  name: string;
  supplierId: string;
  pmId: string;
  createdBy?: string;
  currentStep: number;
  status: ProjectOverallStatus;
  categoryId?: string | null;
  milestones?: ProjectMilestones;
  supplierLinkToken?: string;
  createdAt: string;
}

export enum StepStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked'
}

export interface ProjectStep {
  id: string;
  projectId: string;
  stepNumber: number;
  name: string;
  status: StepStatus;
}

export enum DocStatus {
  NOT_STARTED = 'not_started',
  WAITING_UPLOAD = 'waiting_upload',
  UPLOADED = 'uploaded',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export enum ResponsibleParty {
  INTERNAL = 'internal',
  SUPPLIER = 'supplier'
}

export interface DocVersion {
    id: string;
    fileUrl: string;
    uploadedAt: string;
    uploadedBySupplier: boolean;
    versionNumber: number;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  stepNumber: number;
  title: string;
  description?: string;
  responsibleParty: ResponsibleParty;
  isVisibleToSupplier: boolean;
  isRequired: boolean;
  status: DocStatus;
  deadline?: string;
  fileUrl?: string;
  uploadedAt?: string;
  versions?: DocVersion[];
  supplierComment?: string;
}

export interface ProjectAttributeRequest {
  id: string;
  projectId: string;
  projectIdCode: string;
  categoryId: string | null;
  projectName: string;
  categoryName: string;
  token: string;
  step: 2 | 3;
  skuNumber: string;
  skuTitle: string;
  status: 'pending' | 'submitted';
  submittedData?: Array<{ attributeId: string; name: string; value: string; type?: string }> | null;
  note?: string | null;
  createdAt: string;
  submittedAt?: string | null;
}

export interface SkuAttributeValue {
  attributeId: string;
  name: string;
  value: string;
  type?: string;
}

export interface ProjectSku {
  id: string;
  projectId: string;
  skuNumber: string;
  skuTitle: string;
  attributeValues: SkuAttributeValue[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A review flag on a single (SKU, attribute) cell in the Attribute Viewer. One flag per cell;
 * re-flagging updates the existing row. Flags are resolved rather than deleted to keep the trail.
 */
export interface SkuAttributeFlag {
  id: string;
  projectSkuId: string;
  attributeId: string;
  status: 'open' | 'resolved';
  comment: string;
  flaggedBy: string | null;
  flaggedByName: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface DocumentComment {
  id: string;
  documentId: string;
  content: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}
