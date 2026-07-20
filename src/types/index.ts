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
  DocumentComment,
  ProjectAttributeRequest,
  ProjectSku,
  CatalogSku,
  SkuAttributeValue,
  SkuAttributeFlag,
  SkuChangeLogEntry
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
  CategoryAttribute,
  AttributeDataType,
  AttributeValidationRules
} from './compliance.types';

// IM types
export type {
  IMMasterLayoutName,
  IMMasterPageOverride,
  IMTemplateMetadata,
  IMTemplateType,
  IMTemplate,
  IMSection,
  ProjectIM,
  ProjectBlockAddition,
  ProjectExtraSection,
  // Block refs
  InlineBlockRef,
  SharedBlockRef,
  SKUSlotRef,
  BlockRef,
  CalloutVariant,
  FeatureConditionFields,
  // IMBlock
  IMBlock,
  // SKU content schemas
  RichTextContent,
  AnnotatedImage,
  AnnotatedImageSetContent,
  LegendTableContent,
  StepSequenceContent,
  SKUContentValue,
  // ResolvedManual node tree
  ResolvedHtmlNode,
  ResolvedCalloutNode,
  ResolvedAnnotatedImageSetNode,
  ResolvedLegendTableNode,
  ResolvedStepSequenceNode,
  ResolvedNode,
  ResolvedSection,
  ResolvedManual
} from './im.types';
export { IM_TEMPLATE_TYPE_LABELS, RESOLVED_MANUAL_SCHEMA_VERSION, localizedSectionTitle } from './im.types';

// Sourcing types
export { RFQStatus, RFQEntryStatus } from './sourcing.types';
export type {
  RFQAttributeValue,
  RFQAttributeResponse,
  RFQAttachment,
  RFQEntry,
  RFQ,
  SupplierProposal
} from './sourcing.types';

// Manufacturing types
export { ProductionDelayReason } from './manufacturing.types';
export type { ProductionUpdate } from './manufacturing.types';

// Toast types
export type { Toast, ToastType, ToastContextType } from './toast.types';

// AI types
export type { AIPrompt, PromptLibraryEntry, TranslationVerbatim } from './ai.types';
