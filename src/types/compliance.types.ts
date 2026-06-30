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

export interface CategoryL3 {
  id: string;
  name: string;
  active: boolean;
  isFinalized: boolean;
  finalizedAt?: string | null;
  pmId?: string | null;    // PM assigned to own this category
  pmName?: string | null;  // Denormalised for display
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
  referenceCode?: string;
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
}
