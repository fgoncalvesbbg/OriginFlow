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
  SkuChangeLogEntry,
  JiraIssueRef,
  JiraLookup
} from './project.types';

// Compliance types
export { ComplianceRequestStatus, ComplianceResponseStatus } from './compliance.types';
export type {
  CategoryL1,
  CategoryL2,
  CategoryL3,
  CategoryTree,
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
  // Asset library
  AssetFolder,
  IMAsset,
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

// Feedback types
export type { FeedbackReport, FeedbackReportType, FeedbackReportStatus } from './feedback.types';

// Regulatory types
export type {
  RegulationStatus,
  Regulation,
  RegulationInput,
  TemplateRegulation,
  TemplateRegulationSource,
  RegCheckSeverity,
  RegCheckFindingKind,
  RegCheckStatus,
  VerbatimVerification,
  RegulatoryFinding,
  RegulatoryVerbatim,
  RegulatoryCheckFailure,
  RegulatoryCheckReport,
  RegulatoryCheckRun
} from './regulatory.types';
