/**
 * Compliance module
 * Technical Compliance Framework (TCF) management
 */

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
  checkComplianceDeadlines
} from './compliance.service';

export {
  getCategories,
  createCategory,
  saveCategory,
  deleteCategory,
  getProductFeatures,
  saveProductFeature,
  deleteProductFeature
} from './compliance-category.service';

export {
  getComplianceRequirements,
  saveRequirement,
  deleteRequirement,
  addStandardRequirements,
  getCategoryAttributes,
  saveCategoryAttribute,
  deleteCategoryAttribute
} from './compliance-requirement.service';

export { COMPLIANCE_SECTIONS } from '../apiService';
