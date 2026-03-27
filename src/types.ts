
export enum UserRole {
  ADMIN = 'ADMIN',
  PM = 'PM',
  SUPPLIER = 'SUPPLIER'
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
}

export interface Supplier {
  id: string;
  name: string;
  code: string;
  email: string;
  portalToken?: string;
  accessCode?: string;
}

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

export interface DeadlineItem {
    id: string;
    projectId: string;
    title: string;
    projectName: string;
    deadline: string;
    daysLeft: number;
    type: 'doc' | 'tcf';
}

export interface DashboardStats {
    activeProjects: number;
    pendingReviews: number;
    overdueCount: number;
    upcomingDeadlines: DeadlineItem[];
}

// --- Compliance ---

export enum ComplianceRequestStatus {
  PENDING_SUPPLIER = 'pending_supplier',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export enum ComplianceResponseStatus {
  COMPLY = 'comply',
  CANNOT_COMPLY = 'cannot_comply',
  NOT_APPLICABLE = 'not_applicable'
}

export interface CategoryL3 {
  id: string;
  name: string;
  active: boolean;
  isFinalized: boolean;
  finalizedAt?: string | null;
}

export interface ProductFeature {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
}

export interface ComplianceRequirement {
  id: string;
  categoryId: string;
  section?: string;
  title: string;
  description: string;
  isMandatory: boolean;
  referenceCode?: string;
  appliesByDefault: boolean;
  conditionFeatureIds: string[];
  timingType?: string; // 'ETD' | 'POST_ETD'
  timingWeeks?: number;
  selfDeclarationAccepted?: boolean;
  testReportOrigin?: string; // 'third_party_mandatory' | 'supplier_inhouse'
}

export interface ComplianceResponseItem {
  requirementId: string;
  status: ComplianceResponseStatus;
  comment?: string;
}

export interface ChangeLogEntry {
  date: string;
  user: string;
  action: string;
}

export interface ComplianceRequest {
  id: string;
  requestId: string;
  projectId: string;
  projectName: string;
  supplierId: string;
  categoryId: string;
  features: { featureId: string; value: boolean }[];
  status: ComplianceRequestStatus;
  responses: ComplianceResponseItem[];
  token: string;
  accessCode?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  updatedBy?: string;
  deadline?: string;
  changeLog?: ChangeLogEntry[];
  respondentName?: string;
  respondentPosition?: string;
}

// --- IM ---

export interface IMTemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;
  brand?: {
    fontFamilies: {
      body: string;
      heading: string;
    };
    fontSizes: {
      body: number;
      small: number;
    };
    headingScale: {
      h1: number;
      h2: number;
      h3: number;
    };
    textColors: {
      primary: string;
      heading: string;
      body: string;
      muted: string;
    };
  };
  layout?: {
    margins: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    columns: {
      count: number;
      gap: number;
    };
    headerHeight: number;
    footerHeight: number;
    pageNumberingStyle: 'numeric' | 'roman' | 'none';
  };
  assets?: {
    iconSet: string;
    watermarkAssetUrl?: string;
    backgroundAssetUrl?: string;
  };
  pages?: {
    coverTemplate: string;
    chapterOpenerTemplate: string;
    bodyTemplate: string;
    endPageVariants: string[];
  };
  coverImageUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  backPageContent?: string;
  footerText?: string;
}

export interface IMTemplate {
  id: string;
  categoryId: string;
  name: string;
  languages: string[];
  isFinalized: boolean;
  finalizedAt?: string;
  metadata?: IMTemplateMetadata;
  updatedAt?: string;
  lastUpdatedBy?: string;
}

export interface IMSection {
  id: string;
  templateId: string;
  parentId?: string | null;
  title: string;
  order: number;
  isPlaceholder: boolean;
  content: Record<string, string>; // langCode -> html
}

export interface ProjectIM {
  id: string;
  templateId: string;
  placeholderData: Record<string, string>;
  status: 'draft' | 'generated';
  updatedAt: string;
}

// --- Sourcing ---

export enum RFQStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  AWARDED = 'awarded'
}

export enum RFQEntryStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  AWARDED = 'awarded'
}

export interface CategoryAttribute {
  id: string;
  categoryId: string;
  name: string;
  dataType: 'text' | 'number';
}

export interface RFQAttributeValue {
  attributeId: string;
  name: string;
  value: string;
  type: 'fixed' | 'range' | 'text';
}

export interface RFQAttachment {
  name: string;
  url: string;
  type: string;
}

export interface RFQEntry {
  id: string;
  rfqId: string;
  supplierId: string;
  token: string;
  status: RFQEntryStatus;
  unitPrice?: number;
  moq?: number;
  leadTimeWeeks?: number;
  toolingCost?: number;
  currency?: string;
  supplierNotes?: string;
  quoteFileUrl?: string;
  submittedAt?: string;
  createdAt: string;
  supplierName?: string;
  rfqTitle?: string;
  rfqIdentifier?: string;
}

export interface RFQ {
  id: string;
  rfqId: string;
  title: string;
  categoryId?: string;
  description: string;
  attributes: RFQAttributeValue[];
  thumbnailUrl?: string;
  attachments: RFQAttachment[];
  createdBy: string;
  createdAt: string;
  status: RFQStatus;
  categoryName?: string;
  entries?: RFQEntry[];
}

export interface SupplierProposal {
  id: string;
  supplierId: string;
  supplierName?: string;
  title: string;
  description: string;
  fileUrl: string;
  status: string;
  createdAt: string;
}

// --- Manufacturing ---

export enum ProductionDelayReason {
  MATERIAL_SHORTAGE = 'Material Shortage',
  CAPACITY_ISSUE = 'Capacity Issue',
  QUALITY_FAIL = 'Quality Failure',
  LOGISTICS_DELAY = 'Logistics Delay',
  OTHER = 'Other'
}

export interface ProductionUpdate {
  id: string;
  projectId: string;
  previousEtd?: string;
  newEtd: string;
  isOnTime: boolean;
  delayReason?: ProductionDelayReason;
  notes?: string;
  updatedBy?: string;
  isSupplierUpdate: boolean;
  createdAt: string;
}

// --- Others ---

export interface Notification {
  id: string;
  userId: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface DocumentComment {
  id: string;
  documentId: string;
  content: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}
