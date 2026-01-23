/**
 * Services module
 * Central export point for all application services
 */

// Core infrastructure
export { supabase, portalClient, isLive } from './core/supabase.client';

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
  getMissingDocumentsForSupplier
} from './project';

// Supplier module
export {
  getSuppliers,
  getSupplierById,
  getSupplierByToken,
  createSupplier,
  updateSupplier,
  ensureSupplierToken
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
  getProductFeatures,
  saveProductFeature,
  deleteProductFeature,
  getComplianceRequirements,
  saveRequirement,
  deleteRequirement,
  addStandardRequirements,
  getCategoryAttributes,
  saveCategoryAttribute,
  deleteCategoryAttribute
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
  deleteProjectIM
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
  createSupplierProposal
} from './sourcing';
