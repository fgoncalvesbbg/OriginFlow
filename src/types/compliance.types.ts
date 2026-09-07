/**
 * Compliance module types (Technical Compliance Framework)
 */

import { FeatureConditionFields } from './im.types';

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

/**
 * The category tree is three levels: L1 (department) > L2 (family) > L3 (leaf).
 * Only L3 is referenced by the rest of the app — projects, RFQs, compliance requests,
 * requirements, product features, proposals and attributes all point at a categories_l3 id.
 * L1/L2 exist to organise and filter that list, never to be selected as a category.
 */
export interface CategoryL1 {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CategoryL2 {
  id: string;
  l1Id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CategoryL3 {
  id: string;
  name: string;
  active: boolean;
  isFinalized: boolean;
  finalizedAt?: string | null;
  pmId?: string | null;    // PM assigned to own this category
  pmName?: string | null;  // Denormalised for display
  /**
   * Parent L2, or null for an uncategorised leaf. A leaf may legitimately sit outside the
   * tree — legacy rows are parked there rather than deleted — so every consumer must treat
   * null as "no parent yet", not as a bug.
   */
  l2Id?: string | null;
  l2Name?: string | null;  // Denormalised from the tree for display and grouping
  l1Id?: string | null;
  l1Name?: string | null;
  sortOrder?: number;
}

/** Convenience shape for the grouped pickers: one L1 with its L2s and their leaves. */
export interface CategoryTree {
  l1: CategoryL1[];
  l2: CategoryL2[];
}

export interface ProductFeature {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
}

export interface ComplianceRequirement {
  id: string;
  /** null = global requirement that applies to every category (shown locked per-category). */
  categoryId: string | null;
  section?: string;
  title: string;
  description: string;
  isMandatory: boolean;
  /**
   * Free-text citation. Superseded by `regulationId` for anything with a regulation behind
   * it (migration 139) and rendered nowhere; kept as the fallback label for unlinked rows
   * and as the value the backfill matched on.
   */
  referenceCode?: string;
  /**
   * The `regulations` row this deliverable exists to satisfy, or null/undefined for a
   * requirement with no regulation behind it — BOM, exploded view, packaging artwork are
   * real asks, not legal obligations (migration 139). This is the join that makes the
   * regulation library one brain instead of two: the regulation carries the summary, the
   * version and the IM checklist; this row carries what the SUPPLIER must hand over.
   */
  regulationId?: string | null;
  /**
   * The specific clause this evidence satisfies, when the obligation is narrower than the
   * whole document — "LVD Annex III", not "the LVD" (migration 141). Null means the
   * requirement answers for the regulation as a whole.
   */
  clauseId?: string | null;
  appliesByDefault: boolean;
  /**
   * Attribute-based applicability gate (mirrors IM block refs). When set, the
   * requirement only applies if the captured project attribute values satisfy
   * this condition (evaluated via passesFeatureGate). Null/absent = no gate.
   */
  condition?: FeatureConditionFields | null;
  /** @deprecated superseded by `condition`; kept for back-compat reads only. */
  conditionFeatureIds?: string[];
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
  /** @deprecated legacy product-feature toggles; superseded by conditionAttributes. */
  features: { featureId: string; value: boolean }[];
  /**
   * Attribute values captured at request creation, used to gate which
   * requirements apply. Keyed by attribute id. Mirrors the placeholderData
   * map passed to passesFeatureGate.
   */
  conditionAttributes?: Record<string, string>;
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

export type AttributeDataType = 'text' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'image';

/**
 * Placeholder intake wizard gate (migration 142). 'regulatory' blocks a non-draft
 * publish/print while any question at that tier is still pending (see
 * ProjectIMGenerator.buildPublishIssues and render-print-prepare.ts). 'recommended' and
 * 'optional' are advisory only. A parallel `PlaceholderTier` (im-placeholder-wizard.types.ts)
 * carries the same three values for `im_adhoc_placeholders` rows, kept as a separate type so
 * this file and that one don't need to import each other for one shared union.
 */
export type WizardTier = 'regulatory' | 'recommended' | 'optional';

export interface AttributeValidationRules {
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  allowRange?: boolean;
  enumOptions?: string[];
  placeholder?: string;
  required?: boolean;
}

export interface CategoryAttribute {
  id: string;
  categoryId: string | null; // null = global (predefined groups, shared across all categories)
  assignedCategoryIds?: string[]; // additional categories this attribute is shared into
  name: string;
  dataType: AttributeDataType;
  validationRules?: AttributeValidationRules;
  group?: string;
  akeneoId?: string;
  /**
   * false = internal only: never rendered in a supplier-facing attribute list.
   * Defaults to true (visible) so an attribute is only hidden when someone says so.
   * Presentation filter, not access control — see db_migrations/134.
   */
  supplierVisible?: boolean;
  /** Order within the attribute group. 0/undefined = unordered, falls back to name. */
  sortOrder?: number;
  /** ProductToolkit's stable attribute id — the rename-safe sync key (migration 138). */
  ptAttributeId?: number | null;
  /** EPREL identifier from the ProductToolkit definition. Reference only. */
  eprelId?: string | null;
  /** Placeholder intake wizard gate (migration 142). Absent/undefined reads as 'optional'. */
  wizardTier?: WizardTier;
  /** Always-visible short guidance shown under the question in the wizard. */
  wizardHint?: string | null;
  /** Longer guidance shown behind an expandable disclosure, not always visible. */
  wizardNote?: string | null;
  /** Pre-filled suggestion shown when no answer exists yet; never auto-committed as an answer. */
  wizardDefaultValue?: string | null;
  /**
   * The single other attribute (or its absence) this question is sequenced behind in the
   * wizard, in the same shape IM block refs already gate visibility with (reusing
   * FeatureConditionFields rather than a parallel condition shape). Built from the five
   * `wizard_depends_on_*` columns by `wizardConditionFromRow` (attribute-condition.utils.ts).
   * Null/absent = no dependency, always eligible.
   */
  wizardCondition?: FeatureConditionFields | null;
}
