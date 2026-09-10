/**
 * Types module - Centralized type definitions
 * Re-exports all types for backward compatibility and organized access
 */

// Common types
export { UserRole } from './common.types';
export type { User, Supplier, DeadlineItem, DashboardStats, Notification } from './common.types';

// Project inbox types
export type { InboxKind, InboxLane, InboxItem, InboxSnapshot } from './inbox.types';

// Project types
export { ProjectOverallStatus, StepStatus, DocStatus, ResponsibleParty } from './project.types';
export type {
  ProjectMilestones,
  Project,
  ProjectStep,
  DocVersion,
  ProjectDocument,
  DocumentComment,
  ProjectTemplate,
  TemplateStep,
  TemplateDocument,
  ProjectAttributeRequest,
  ProjectSku,
  CatalogSku,
  SkuAttributeValue,
  SkuAttributeValueRecord,
  SkuValueSource,
  SkuCellState,
  SkuAttributeFlag,
  SkuChangeLogEntry,
  JiraIssueRef,
  JiraLookup
} from './project.types';

// SOP & Documents types
export { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from './document.types';
export type {
  DocumentType,
  DocumentAudience,
  RegisteredDocument,
  RegisteredDocumentRow,
  FinalVersionSummary,
  DocumentVersion,
  DocumentVersionEvent,
  SupplierDocument,
  SupplierDocumentVersion,
  SupplierProjectDocument,
  InternalProjectDocument,
  DocumentBinding,
  TemplateDocumentLink,
  DocumentRegistryFilters
} from './document.types';

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
  AttributeValidationRules,
  WizardTier,
  ComplianceRequirementHistoryEntry,
  ComplianceHistoryAction,
  ComplianceQuestion,
  TcfQuestionDataType,
  ComplianceSection
} from './compliance.types';

// IM types
export type {
  IMMasterLayoutName,
  IMMasterPageOverride,
  IMTemplateMetadata,
  IMTemplateType,
  IMReviewStage,
  IMTemplate,
  IMSection,
  ProjectIM,
  ProjectBlockAddition,
  ProjectExtraSection,
  ProjectAttachmentEntry,
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
export { IM_TEMPLATE_TYPE_LABELS, IM_REVIEW_STAGE_LABELS, RESOLVED_MANUAL_SCHEMA_VERSION, localizedSectionTitle } from './im.types';

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
  ObligationCarrier,
  ClauseKind,
  RegulationClause,
  RegulationClauseInput,
  RegulationObligation,
  RegulationObligationInput,
  RegulationStructure,
  RegulationVersionState,
  RegulationVersionDetail,
  RegulationVersionResult,
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

// IM placeholder intake wizard types (migrations 142/143)
export type {
  PlaceholderTier,
  PlaceholderAnswerStatus,
  PlaceholderAnswerScope,
  PlaceholderAnswerSource,
  PlaceholderAnswerLogAction,
  AdhocPlaceholder,
  WizardQuestion,
  PlaceholderAnswer,
  PlaceholderAnswerLogEntry
} from './im-placeholder-wizard.types';

// Shared supplier-review layer (migration 162) — links, notes, replies and anchors for
// EVERY reviewable document. The IM's own IMShare/IMReviewComment shapes are adapters over
// these; see src/services/review/.
export type {
  ReviewSubjectType,
  ReviewShareMode,
  ReviewStage,
  ReviewCommentStatus,
  ReviewSubject,
  ReviewAttachment,
  TextReviewAnchor,
  PdfReviewAnchor,
  ReviewAnchor,
  ReviewShare,
  ReviewComment,
  ReviewReply,
  ReviewSession
} from './review.types';
export { isPdfAnchor, isReviewShareExpired } from './review.types';

// Design Specs (migrations 163, 171). The supplier round these use is the shared review layer
// above; see src/services/design/ and src/pages/design/design-spec-status.ts.
export type {
  DesignSpecState,
  DesignSpecStage,
  DesignSpecVersion,
  DesignSpec,
  DesignSpecSummary,
  DesignSpecSkuLink
} from './design-spec.types';

// Roadmap Creator (migration 167). Reference data (RoadmapSku / RoadmapImport) is replaced by an
// upload and written only by roadmap_import_skus(); everything else is an annotation written only
// by a person. The terse field names (nov25, sm26, asp25) are the spreadsheet's own vocabulary and
// are load-bearing — the pure grid/chart/summary logic is written against exactly them.
export type {
  RoadmapFlag,
  RoadmapPlacerType,
  RoadmapStatus,
  RoadmapAxisKind,
  RoadmapAuditEntity,
  RoadmapAuditAction,
  RoadmapAttrs,
  RoadmapSku,
  RoadmapItemFlag,
  RoadmapPlacer,
  RoadmapAxisValue,
  RoadmapImport,
  RoadmapAuditEntry,
  RoadmapApprover,
  RoadmapBoard,
  RoadmapCategory,
  RoadmapImportResult,
  RoadmapOrphan
} from './roadmap.types';
