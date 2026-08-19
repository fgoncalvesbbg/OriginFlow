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
export { publishResolvedManuals, normalizeResolverData, getPublishedManifestUrl, getPublishedManualUrl, getProjectRequiredLanguages, getPublishHistory } from './im-publish.service';
export { checkPrintImageWeights, HEAVY_IMAGE_BYTES } from './im-print-preflight.service';
export type { PrintImageReport, PrintImageInfo } from './im-print-preflight.service';
export { getIMMarkets, saveIMMarket, deleteIMMarket } from './im-market.service';
export type { IMMarket } from './im-market.service';
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
} from './im-print-export.service';
export {
  sendRenderToMarkup,
  isMarkupReviewAvailable,
  checkMarkupReviewStatus,
} from './im-review.service';
export type { SendToMarkupParams, MarkupReviewResult, MarkupReviewStatus } from './im-review.service';
export {
  getIMShares,
  createIMShare,
  revokeIMShare,
  resolveIMShareToken,
  getIMShareUrl,
} from './im-share.service';
export type { IMShare } from './im-share.service';
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
  noteTmSegmentsUsed,
  logTmReuse,
  reuseTierFor,
  TM_APPROVAL_BATCH_LIMIT,
  TmApprovalDeniedError,
  TmImmutableSegmentError,
  TmBatchTooLargeError,
} from './im-tm-write.service';
export type {
  TmOrigin,
  TmRunKind,
  TmTierName,
  RecordTmSegmentInput,
  RecordTmResult,
  TmDivergence,
  TmReuseEvent,
} from './im-tm-write.service';
