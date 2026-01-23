/**
 * Types module - Centralized type definitions
 * Re-exports all types for backward compatibility and organized access
 */

// Common types
export { UserRole } from './common.types';
export type { User, Supplier, DeadlineItem, DashboardStats, Notification } from './common.types';

// Project types
export { ProjectOverallStatus, StepStatus, DocStatus, ResponsibleParty } from './project.types';
export type {
  ProjectMilestones,
  Project,
  ProjectStep,
  DocVersion,
  ProjectDocument,
  DocumentComment
} from './project.types';

// Compliance types
export { ComplianceRequestStatus, ComplianceResponseStatus } from './compliance.types';
export type {
  CategoryL3,
  ProductFeature,
  ComplianceRequirement,
  ComplianceResponseItem,
  ChangeLogEntry,
  ComplianceRequest,
  CategoryAttribute
} from './compliance.types';

// IM types
export type {
  IMTemplateMetadata,
  IMTemplate,
  IMSection,
  ProjectIM
} from './im.types';

// Sourcing types
export { RFQStatus, RFQEntryStatus } from './sourcing.types';
export type {
  RFQAttributeValue,
  RFQAttachment,
  RFQEntry,
  RFQ,
  SupplierProposal
} from './sourcing.types';

// Manufacturing types
export { ProductionDelayReason } from './manufacturing.types';
export type { ProductionUpdate } from './manufacturing.types';

// Modal types
export type { ModalOptions, ConfirmOptions, Modal, ModalContextType } from './modal.types';

// Toast types
export type { Toast, ToastType, ToastContextType } from './toast.types';
