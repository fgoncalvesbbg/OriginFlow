/**
 * IM (Instruction Manual) module
 * Template management and project IM generation
 */

export {
  getIMTemplates,
  getIMTemplateById,
  getIMTemplateByCategoryId,
  createIMTemplate,
  duplicateIMTemplate,
  updateIMTemplate,
  deleteIMTemplate,
  getProjectIMCountForTemplate,
  getOrCreateBlankTemplate,
  BLANK_TEMPLATE_NAME
} from './im-template.service';

export {
  getIMSections,
  saveIMSection,
  deleteIMSection
} from './im-section.service';

export {
  getProjectIM,
  saveProjectIM,
  updateProjectIMPlaceholders,
  setProjectIMFinalized,
  setProjectIMReviewRequested,
  deleteProjectIM,
  getAllProjectIMs,
  getProjectIMBackups,
  ProjectIMConflictError
} from './project-im.service';
export type { ProjectIMBackup } from './project-im.service';

export {
  getIMBlocks,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsageCounts,
  BlockInUseError
} from './im-block.service';

export {
  getAssetFolders,
  createAssetFolder,
  renameAssetFolder,
  deleteAssetFolder,
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  backfillAssetsFromStorage,
} from './im-asset-library.service';

export { resolveManual, TEMP_HIGHLIGHT_CLASS, containsTempHighlight, findTempHighlightSections } from './im-resolver';
export { buildSkuQrSvg, skuQrUrl } from './im-qr-code';
export { buildDocCode, categoryFingerprint, docCodeKind, isValidDocCode, DOC_CODE_RE } from './im-doc-code';
export type { DocCodeInput } from './im-doc-code';
export { publishResolvedManuals, normalizeResolverData, getPublishedManifestUrl, getPublishedManualUrl, getProjectRequiredLanguages, getProjectPrintedLanguages, getPublishHistory } from './im-publish.service';
export { checkPrintImageWeights, HEAVY_IMAGE_BYTES } from './im-print-preflight.service';
export type { PrintImageReport, PrintImageInfo } from './im-print-preflight.service';
export { getIMMarkets, saveIMMarket, deleteIMMarket } from './im-market.service';
export type { IMMarket } from './im-market.service';
export {
  getPrintSettings,
  getPrintTypography,
  savePrintSettingsProfile,
  defaultTypographyFor,
  PRINT_FONT_FAMILIES,
  PRINT_SETTING_LIMITS,
} from './im-print-settings.service';
export type { PrintSettingsProfile, PrintTypography, PrintPageSizeKey, PrintLeafletLayout } from './im-print-settings.service';
export type { PublishResult, PublishHistoryEvent } from './im-publish.service';
export {
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  republishProjectIM,
  stalenessKey,
} from './im-staleness.service';
export type { StaleReason, StaleManual } from './im-staleness.service';
export { getPublishDiff, diffResolvedSections } from './im-publish-diff.service';
export type { PublishDiff, PublishDiffEntry } from './im-publish-diff.service';
export {
  requestPrintPdf,
  requestDraftPrintPdf,
  getPrintPdfUrl,
  getPrintRenders,
  getLatestRendersByManual,
  isPrintExportAvailable,
} from './im-print-export.service';
export type {
  RequestPrintPdfParams,
  PrintPdfResult,
  PrintCoverInput,
  PrintBackInput,
  PrintRender,
  PrintPreflightReport,
  RequestDraftPrintPdfParams,
  DraftPrintPdfResult,
  DraftManualInput,
} from './im-print-export.service';
// Leaflet coverage — which SKUs a leaflet PDF answers for (migration 132). Generic
// per-category leaflets and SKU-specific ones resolve through the same read model.
export {
  getLeafletCoverage,
  getLeafletPolicies,
  setLeafletPolicy,
  getLeafletIssues,
  issueCategoryLeaflet,
  issueLeafletForSkus,
  withdrawLeafletIssue,
} from './leaflet-coverage.service';
export type {
  LeafletMode,
  LeafletCoverageStatus,
  LeafletCoverageRow,
  LeafletPolicy,
  LeafletIssue,
  IssueMeta,
  IssueForSkusResult,
} from './leaflet-coverage.service';
export {
  getIMShares,
  createIMShare,
  revokeIMShare,
  resolveIMShareToken,
  getIMShareUrl,
  getIMReviewUrl,
  isShareExpired,
} from './im-share.service';
export type { IMShare, IMShareMode } from './im-share.service';
// Supplier review round (replaces the Markup.io integration). The first group is the
// anonymous portal path (RPC-only); the second is the PM's triage path.
export {
  resolveReviewShare,
  listReviewCommentsByToken,
  addReviewComment,
  deleteReviewComment,
  submitReview,
  getReviewComments,
  setReviewCommentStatus,
  getOpenReviewCommentCounts,
  uploadReviewImage,
  reviewImageUrl,
  getReviewRoundsByManual,
} from './im-review-comments.service';
export type {
  IMReviewComment,
  IMReviewCommentStatus,
  IMReviewSession,
  AddReviewCommentInput,
  ReviewAttachment,
  ReviewRoundSummary,
} from './im-review-comments.service';
export {
  validateImImport,
  importIMTemplate,
  buildExtraSectionsFromDoc,
  importProjectIMFromDoc,
  exportTemplateForReview,
  importSupplierDraftIntoProject,
} from './im-import.service';
export type {
  ImImportDoc,
  ImImportSection,
  ImImportBlock,
  ImImportBlockType,
  ImImportScope,
  ImImportMatchStatus,
  ImImportImageNeed,
  ImImportValidation,
  ImImportResult,
  ImProjectImportResult,
  TemplateReviewSection,
  TemplateReviewExport,
  ImSupplierDiffImportResult,
} from './im-import.service';
export { buildImImportPrompt } from './im-import-prompt';
export type { ImImportPromptOptions } from './im-import-prompt';
export {
  prefetchTmForRun,
  lookupTmSegment,
  fetchTmCandidates,
  evaluateCandidate,
  mapTmSegmentRow,
} from './im-tm-lookup.service';
export type {
  TmSegmentRecord,
  TmLookupRequest,
  TmMatch,
  TmLookupCache,
} from './im-tm-lookup.service';
export {
  recordTmSegments,
  approveTmSegments,
  deprecateTmSegments,
  replaceApprovedTmSegment,
  updateUnreviewedTmSegment,
  validateTmTargetText,
  noteTmSegmentsUsed,
  logTmReuse,
  reuseTierFor,
  TM_APPROVAL_BATCH_LIMIT,
  TmApprovalDeniedError,
  TmImmutableSegmentError,
  TmBatchTooLargeError,
} from './im-tm-write.service';
export {
  browseTmSegments,
  getTmStats,
  getTmLeverage,
} from './im-tm-admin.service';
export type {
  TmStatus,
  TmBrowseSort,
  TmBrowseFilters,
  TmBrowsePage,
  TmStatsRow,
  TmLeverageRow,
} from './im-tm-admin.service';
export type {
  TmOrigin,
  TmRunKind,
  TmTierName,
  RecordTmSegmentInput,
  RecordTmResult,
  TmDivergence,
  TmReuseEvent,
} from './im-tm-write.service';
