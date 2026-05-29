/**
 * Compliance module types (Technical Compliance Framework)
 */

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

export type AttributeDataType = 'text' | 'integer' | 'decimal' | 'boolean' | 'enum';

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
