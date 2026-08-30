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
  deadline?: string | null;       // when the data is due back from the supplier
  copiedFromSku?: string | null;  // sibling SKU the prefilled values came from, if any
  createdAt: string;
  submittedAt?: string | null;
  /** Shared by every request created in one bulk-send action; null for a single-SKU send.
   *  A batch is filled and submitted together on one page — see SupplierAttributeBatchPortal. */
  batchToken?: string | null;
}

export interface SkuAttributeValue {
  attributeId: string;
  name: string;
  value: string;
  type?: string;
}

export interface ProjectSku {
  id: string;
  projectId: string | null; // null = project-less catalog SKU (legacy item)
  categoryId?: string | null; // category the SKU belongs to; drives its attribute set
  skuNumber: string;
  skuTitle: string;
  attributeValues: SkuAttributeValue[];
  sortOrder: number;
  isFinal: boolean; // locked: no edits without unlocking (which is logged)
  pendingExport: boolean; // has changes not yet exported to Akeneo
  lastExportedAt: string | null; // when it was last exported to Akeneo
  createdAt: string;
  updatedAt: string;
}

/** A SKU enriched with the owning project's name (null for catalog SKUs). */
export interface CatalogSku extends ProjectSku {
  projectName: string | null;
}

/** One append-only entry in a SKU's change/audit log (see sku_change_log). */
export interface SkuChangeLogEntry {
  id: string;
  projectSkuId: string | null;
  skuNumber: string;
  action: 'finalize' | 'unlock' | 'update' | 'create' | 'delete';
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  note: string;
  changedBy: string | null;
  changedByName: string;
  createdAt: string;
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

/**
 * Jira link-through (see netlify/functions/jira-status.ts).
 *
 * Never persisted: these are fetched live from Jira on every load/refresh, so the
 * status shown is always Jira's current one and there is no OriginFlow copy to drift.
 */
export interface JiraIssueRef {
  key: string;
  /** Direct browse link, e.g. https://go-bbg.atlassian.net/browse/PL-123 */
  url: string;
  summary: string;
  /** The workflow status name as configured in Jira, e.g. "In Review". */
  status: string;
  /** Jira's three-bucket rollup — stable across custom workflows, unlike status names. */
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  issueType?: string;
  assignee?: string;
  priority?: string;
  updated?: string;
  dueDate?: string;
  /**
   * How the issue was tied to this project code:
   *   'field'   — Jira's ProjectID custom field, verified exactly (the reliable one)
   *   'key'     — the project code IS the issue key
   *   'summary' — the code appears in the issue summary (field was blank)
   *   'text'    — the code is somewhere in the description/comments (weakest)
   */
  matchedBy?: 'field' | 'summary' | 'text' | 'key';
}

/** Lookup outcome for one project code. `issue === null` means "not on Jira". */
export interface JiraLookup {
  issue: JiraIssueRef | null;
  /** >1 means the launch code matched several issues; `alternates` holds the rest. */
  matchCount: number;
  alternates: JiraIssueRef[];
}
