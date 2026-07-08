/**
 * Services module
 * Central export point for all application services
 */

// Core infrastructure
export { supabase, portalClient } from './core/supabase.client';
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
  deleteSkuAttributeFlag
} from './project';
export type { CategorySku } from './project';

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
  deleteCategoryAttribute,
  assignAttributeToCategory,
  unassignAttributeFromCategory,
  makeAttributeGlobal,
  COMPLIANCE_SECTIONS,
  ATTRIBUTE_GROUPS,
  PREDEFINED_ATTRIBUTE_GROUPS
} from './compliance';

// IM module
export {
  getIMTemplates,
  getIMTemplateById,
  getIMTemplateByCategoryId,
  createIMTemplate,
  updateIMTemplate,
  getIMSections,
  saveIMSection,
  deleteIMSection,
  getProjectIM,
  saveProjectIM,
  deleteProjectIM,
  getAllProjectIMs,
  getIMBlocks,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsageCounts,
  BlockInUseError,
  resolveManual,
  publishResolvedManuals,
  normalizeResolverData,
  getPublishedManifestUrl,
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  republishProjectIM,
  stalenessKey,
  requestPrintPdf,
  getPrintPdfUrl,
  getPrintRenders,
  isPrintExportAvailable,
  getIMShares,
  createIMShare,
  revokeIMShare,
  resolveIMShareToken,
  getIMShareUrl
} from './im';
export type {
  PublishResult,
  StaleReason,
  StaleManual,
  RequestPrintPdfParams,
  PrintPdfResult,
  PrintCoverInput,
  PrintBackInput,
  PrintRender,
  IMShare
} from './im';

// Sourcing module
export {
  getRFQs,
  getRFQById,
  getRFQEntryByToken,
  createRFQ,
  deleteRFQ,
  awardRFQ,
  getRFQsForSupplier,
  submitRFQEntry,
  getAllSupplierProposals,
  getSupplierProposals,
  createEnhancedSupplierProposal,
  convertProposalToRFQ
} from './sourcing';
