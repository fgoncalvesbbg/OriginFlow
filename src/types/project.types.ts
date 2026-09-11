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

/**
 * What a project IS, structurally.
 *
 * `launch` is the normal thing: phases, documents, a supplier, a supplier portal.
 * `reedit` is a skeletal, IM-only project for a SKU that is already live — no phases, no
 * documents, no supplier. It exists because an IM cannot exist without a project
 * (`project_ims.project_id` is NOT NULL and unique per template type), and a live SKU can
 * need a new manual several times over its life. See migration 182.
 */
export type ProjectKind = 'launch' | 'reedit';

export interface Project {
  id: string;
  projectId: string;
  name: string;
  /** Null on a re-edit, and nullable in the database on a launch too. */
  supplierId: string | null;
  /**
   * Null is possible in the database, but note `can_see_project()` is
   * `ADMIN OR pm_id = auth.uid()` — pm_id IS the ACL, so a null one hides the project and
   * every child row from all non-admins. Re-edits set it to their creator for this reason.
   */
  pmId: string | null;
  createdBy?: string;
  currentStep: number;
  status: ProjectOverallStatus;
  kind: ProjectKind;
  categoryId?: string | null;
  milestones?: ProjectMilestones;
  supplierLinkToken?: string | null;
  /** Re-edits only: the launch project whose IM this revises, if it is known. */
  sourceProjectId?: string | null;
  /** Re-edits only: what must change and why. Mandatory for `kind === 'reedit'`. */
  reeditRequirement?: string | null;
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
  /**
   * Due date for the whole phase (migration 181). Documents in the phase inherit it; one
   * that sets its own date keeps it (`ProjectDocument.deadlineIsCustom`).
   *
   * The inheritance is resolved in the DATABASE, by a trigger that cascades this into
   * `project_documents.deadline` — so every screen that already reads a document's deadline
   * is correct without knowing this column exists. See the migration for why read-time
   * resolution was rejected.
   */
  deadline?: string | null;
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
  /**
   * True when this document's date was set on its own and must survive a phase-date change
   * (migration 181). False means the date is the phase's and moves with it.
   */
  deadlineIsCustom?: boolean;
  fileUrl?: string;
  uploadedAt?: string;
  versions?: DocVersion[];
  supplierComment?: string;
}

/**
 * Admin-defined standard project structure — a named set of phases and, per phase, the
 * documents a launch of this type always needs. createProject() reads the default template
 * and stamps its steps/documents onto every new project (see ProjectStep/ProjectDocument
 * above, which are the per-project instances these are copied into).
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  /** The template createProject() uses. Exactly one template carries this at a time. */
  isDefault: boolean;
  createdAt: string;
}

export interface TemplateStep {
  id: string;
  templateId: string;
  stepNumber: number;
  name: string;
}

export interface TemplateDocument {
  id: string;
  templateId: string;
  stepNumber: number;
  title: string;
  description?: string;
  responsibleParty: ResponsibleParty;
  isVisibleToSupplier: boolean;
  isRequired: boolean;
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
  /**
   * Attributes the SKU was deliberately CLEARED on when this request was created — recorded as
   * "this product genuinely has none of that". The supplier form does not ask for them.
   *
   * A SNAPSHOT, not a live lookup (migration 164): a request is a record of what was asked, so
   * clearing another field next week must not change an existing request under the supplier, and
   * a submitted request must still show what the question was.
   */
  notApplicableAttributeIds?: string[];
}

export interface SkuAttributeValue {
  attributeId: string;
  name: string;
  value: string;
  type?: string;
}

/**
 * Where a stored attribute value came from. Not decoration: an importer has to be able
 * to say "the supplier gave us this" rather than "a person decided this", and an EPREL
 * seed must stay distinguishable from a confirmed edit. Mirrors the
 * `sku_attribute_values_source_check` constraint (migration 155).
 */
export type SkuValueSource =
  | 'manual'
  | 'sheet-import'
  | 'pt-import'
  | 'supplier'
  | 'wizard'
  | 'eprel';

/**
 * One stored (SKU record, attribute) value — a row of `sku_attribute_values`, which is
 * authoritative over `project_skus.attribute_values` (kept as a mirror; see migration 155).
 *
 * `value === null` means the cell was **explicitly cleared**. A cell nobody has ever
 * touched has NO RECORD AT ALL rather than a record holding null. Keeping those apart is
 * what makes a coverage figure mean something, so nothing in this codebase may collapse
 * them into `''`.
 */
export interface SkuAttributeValueRecord {
  id: string;
  projectSkuId: string;
  attributeId: string;
  /** Verbatim as typed. `null` = explicitly cleared. */
  value: string | null;
  /** The unit this value was captured in — belongs to the value, not the attribute default. */
  unit: string | null;
  source: SkuValueSource;
  updatedBy: string | null;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a grid cell is, once its stored record (or absence) is read against its attribute
 * definition. ProductToolkit needed eight states because it was reconciling two systems;
 * with OriginFlow as the system of record there are four, and each is a different thing
 * to do about it:
 *
 *  - `filled`  — a value is stored and it is valid. Nothing to do.
 *  - `empty`   — no record. Nobody has looked at this cell; it is a gap to fill.
 *  - `cleared` — a record holding null. Somebody decided this product genuinely has none.
 *  - `invalid` — a value is stored that its attribute cannot hold (off-list option, or a
 *                non-number in a numeric field). Real regardless of any export target.
 */
export type SkuCellState = 'filled' | 'empty' | 'cleared' | 'invalid';

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
  /** When is_final was last set true. Stamped by a trigger, not by the client (migration 158). */
  finalizedAt?: string | null;
  finalizedBy?: string | null;
  /**
   * Why a signed-off SKU was reopened. Shown on the SKU column header, because "why is this
   * one still open?" is the question a reader scanning a hundred columns asks (migration 157).
   */
  reopenReason?: string | null;
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
 * One launch == one Jira EPIC whose "ProjectID" field holds the project code, so
 * `status` is the launch stage ("RFQ CREATION" -> "BUSINESS CASE" -> "Gates" ->
 * "PO PLACEMENT" -> "PRODUCTION" -> "Go Live" / "Done"). Gate sub-tickets are excluded.
 *
 * Never persisted: fetched live from Jira on every load/refresh, so the status shown is
 * always Jira's current one and there is no OriginFlow copy to drift.
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
}

/** Lookup outcome for one project code. `issue === null` means "no Epic carries this code". */
export interface JiraLookup {
  issue: JiraIssueRef | null;
  /** Expected to be 1. >1 means several Epics share the code; `alternates` holds the rest. */
  matchCount: number;
  alternates: JiraIssueRef[];
}
