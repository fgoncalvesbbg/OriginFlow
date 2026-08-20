/**
 * Services module
 * Central export point for all application services
 */

// Core infrastructure. Data access itself is NOT re-exported here — application code
// reaches a backend only through the ports in `src/data`, never through a driver client.
export { isLive } from '../config/environment.config';

// Storage module
export { getPortalDocumentUrl, getSignedDocumentUrl, openSignedDocument } from './storage/signed-url.service';

// Auth module
export {
  login,
  signUp,
  logout,
  getProfiles,
  getUserProfile,
  updateUserRole
} from './auth';

// Project module
export {
  getProjects,
  getProjectById,
  getProjectByToken,
  getProjectsBySupplierToken,
  createProject,
  updateProject,
  deleteProject,
  saveProjectMilestones,
  getProjectSteps,
  updateStepStatus,
  getProjectDocs,
  addDocument,
  updateDocumentMetadata,
  updateDocStatus,
  removeDocument,
  uploadFile,
  uploadAdHocFile,
  deleteDocumentVersion,
  addDocumentComment,
  getMissingDocumentsForSupplier,
  createAttributeRequest,
  getAttributeRequestsByProject,
  getAttributeRequestsByProjectPublic,
  getAttributeRequestsForSupplier,
  getAttributeRequestByToken,
  submitAttributeRequest,
  updateAttributeRequestData,
  deleteAttributeRequest,
  MAX_SKUS_PER_PROJECT,
  getProjectSkus,
  createProjectSku,
  updateProjectSku,
  deleteProjectSku,
  getEffectiveSkuValue,
  collapseSkuAttributeValues,
  getSkusByCategory,
  getFlagsForSkus,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag,
  getCatalogSkus,
  createCatalogSku,
  bulkUpsertCatalogSkus,
  setSkuFinal,
  logSkuChanges,
  logSkuCreated,
  logSkuDeleted,
  markSkusExported,
  getSkuChangeLog
} from './project';
export type { CategorySku } from './project';
export type { ParsedSkuRow, BulkUpsertSkuResult, ChangeActor, SkuFieldChange } from './project';

// Supplier module
export {
  getSuppliers,
  getSupplierById,
  getSupplierByToken,
  verifySupplierPortalAccess,
  createSupplier,
  updateSupplier,
  ensureSupplierToken,
  assignSupplierToPMs,
  getSupplierPMs,
  reassignProjectPM,
  regenerateSupplierAccessCode,
  logAccessCodeAttempt
} from './supplier';

// Manufacturing module
export {
  getProductionUpdates,
  getAllProductionUpdates,
  saveProductionUpdate
} from './manufacturing';

// Shared services
export {
  getDashboardStats,
  getNotifications,
  getSupplierNotifications,
  markNotificationRead,
  triggerEmailNotification
} from './shared';

// Compliance module
export {
  getComplianceRequests,
  getComplianceRequestById,
  getComplianceRequestsBySupplierCode,
  getComplianceRequestsBySupplierToken,
  createComplianceRequest,
  verifySupplierAccess,
  submitComplianceResponseSecure,
  submitComplianceResponse,
  deleteComplianceRequest,
  checkComplianceDeadlines,
  getCategories,
  saveCategory,
  deleteCategory,
  assignPMToCategory,
  getComplianceRequirements,
  saveRequirement,
  deleteRequirement,
  addStandardRequirements,
  getComplianceSections,
  addComplianceSection,
  deleteComplianceSection,
  getCategoryAttributes,
  saveCategoryAttribute,
  importCategoryAttributes,
  deleteCategoryAttribute,
  assignAttributeToCategory,
  unassignAttributeFromCategory,
  makeAttributeGlobal,
  COMPLIANCE_SECTIONS,
  ATTRIBUTE_GROUPS,
  PREDEFINED_ATTRIBUTE_GROUPS
} from './compliance';
export type { ImportAttributesResult } from './compliance';

// IM module
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
  BLANK_TEMPLATE_NAME,
  getIMSections,
  saveIMSection,
  deleteIMSection,
  getProjectIM,
  saveProjectIM,
  updateProjectIMPlaceholders,
  setProjectIMFinalized,
  deleteProjectIM,
  getAllProjectIMs,
  getProjectIMBackups,
  ProjectIMConflictError,
  getIMBlocks,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsageCounts,
  BlockInUseError,
  getAssetFolders,
  createAssetFolder,
  renameAssetFolder,
  deleteAssetFolder,
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  backfillAssetsFromStorage,
  resolveManual,
  TEMP_HIGHLIGHT_CLASS,
  containsTempHighlight,
  findTempHighlightSections,
  publishResolvedManuals,
  normalizeResolverData,
  getPublishedManifestUrl,
  getProjectRequiredLanguages,
  getPublishHistory,
  getIMMarkets,
  saveIMMarket,
  deleteIMMarket,
  checkPrintImageWeights,
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  republishProjectIM,
  stalenessKey,
  getPublishDiff,
  requestPrintPdf,
  getPrintPdfUrl,
  getPrintRenders,
  getLatestRendersByManual,
  isPrintExportAvailable,
  sendRenderToMarkup,
  isMarkupReviewAvailable,
  checkMarkupReviewStatus,
  getIMShares,
  createIMShare,
  revokeIMShare,
  resolveIMShareToken,
  getIMShareUrl,
  validateImImport,
  importIMTemplate,
  buildExtraSectionsFromDoc,
  importProjectIMFromDoc,
  exportTemplateForReview,
  importSupplierDraftIntoProject,
  prefetchTmForRun,
  lookupTmSegment,
  fetchTmCandidates,
  evaluateCandidate,
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
  TmBatchTooLargeError
} from './im';
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
  PublishResult,
  PublishHistoryEvent,
  ProjectIMBackup,
  IMMarket,
  StaleReason,
  StaleManual,
  PublishDiff,
  PublishDiffEntry,
  PrintImageReport,
  PrintImageInfo,
  RequestPrintPdfParams,
  PrintPdfResult,
  PrintCoverInput,
  PrintBackInput,
  PrintRender,
  SendToMarkupParams,
  MarkupReviewResult,
  MarkupReviewStatus,
  IMShare,
  TmSegmentRecord,
  TmLookupRequest,
  TmMatch,
  TmLookupCache,
  TmOrigin,
  TmRunKind,
  TmTierName,
  RecordTmSegmentInput,
  RecordTmResult,
  TmDivergence,
  TmReuseEvent
} from './im';

// Sourcing module
export {
  getRFQs,
  getRFQById,
  getRFQEntryByToken,
  createRFQ,
  deleteRFQ,
  awardRFQ,
  reopenRFQEntry,
  getRFQsForSupplier,
  submitRFQEntry,
  getAllSupplierProposals,
  getSupplierProposals,
  createEnhancedSupplierProposal,
  convertProposalToRFQ
} from './sourcing';

// AI module
export { getAIPrompts, updateAIPrompt, getPromptLibrary, createPromptLibraryEntry, updatePromptLibraryEntry, deletePromptLibraryEntry, getTranslationVerbatims, createTranslationVerbatim, updateTranslationVerbatim, deleteTranslationVerbatim } from './ai';

// Regulatory module — regulation library, per-template assignment, AI regulatory check
export {
  getRegulations,
  getRegulationById,
  createRegulation,
  updateRegulation,
  deleteRegulation,
  getRegulationUsageCounts,
  summaryByteLength,
  RegulationInUseError,
  MAX_SUMMARY_BYTES,
  SUMMARY_WARN_BYTES,
  getTemplateRegulations,
  getTemplateRegulationCounts,
  assignRegulationToTemplate,
  updateTemplateRegulationNotes,
  unassignRegulationFromTemplate,
  buildRegCheckDocument,
  runRegulatoryCheck,
  getRegulatoryCheckHistory,
  verifyVerbatimPhrase,
  registerVerbatimFinding,
  serializeTemplateForRegCheck,
  chunkRegCheckDocument,
  htmlToStructuredText,
  REG_CHECK_BLOCK_CHAR_CAP,
  REG_CHECK_CHUNK_CHARS
} from './regulatory';
export type {
  RegCheckProgress,
  RegCheckDocument,
  RegCheckSection,
  RegCheckBlock,
  RegCheckBlockKind
} from './regulatory';
