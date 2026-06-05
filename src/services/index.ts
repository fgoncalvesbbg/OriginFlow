/**
 * Services module
 * Central export point for all application services
 */

// Core infrastructure
export { supabase, portalClient } from './core/supabase.client';
export { isLive } from '../config/environment.config';

// Auth module
export {
  login,
  signUp,
  logout,
  getSessionUser,
  getProfiles,
  getUserProfile,
  updateUserRole
} from './auth';

// Project module
export {
  getProjects,
  getProjectById,
  getProjectByToken,
  getProjectsBySupplierId,
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
  getDocumentComments,
  addDocumentComment,
  getMissingDocumentsForSupplier,
  createAttributeRequest,
  getAttributeRequestsByProject,
  getAttributeRequestsByProjectPublic,
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
  collapseSkuAttributeValues
} from './project';

// Supplier module
export {
  getSuppliers,
  getSupplierById,
  getSupplierByToken,
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
  triggerEmailNotification,
  getDocumentComments as getSharedDocumentComments,
  addDocumentComment as addSharedDocumentComment
} from './shared';

// Compliance module
export {
  getComplianceRequests,
  getComplianceRequestById,
  getComplianceRequestByToken,
  getComplianceRequestsBySupplierId,
  createComplianceRequest,
  verifySupplierAccess,
  submitComplianceResponseSecure,
  submitComplianceResponse,
  deleteComplianceRequest,
  checkComplianceDeadlines,
  getCategories,
  createCategory,
  saveCategory,
  deleteCategory,
  assignPMToCategory,
  getProductFeatures,
  saveProductFeature,
  deleteProductFeature,
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
  getIMBlockById,
  getIMBlockBySlug,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsage,
  getIMBlockUsageCounts,
  BlockInUseError,
  resolveManual,
  publishResolvedManuals,
  normalizeResolverData,
  getPublishedManifestUrl,
  getStaleProjectIMKeys,
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  isProjectIMStale,
  republishProjectIM,
  stalenessKey
} from './im';
export type { PublishResult, PublishedLanguage, IMBlockUsageRef, StaleReason, StaleManual } from './im';

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
  createSupplierProposal,
  createEnhancedSupplierProposal,
  convertProposalToRFQ
} from './sourcing';
