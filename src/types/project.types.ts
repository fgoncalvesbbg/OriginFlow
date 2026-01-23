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
  currentStep: number;
  status: ProjectOverallStatus;
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

export interface DocumentComment {
  id: string;
  documentId: string;
  content: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}
