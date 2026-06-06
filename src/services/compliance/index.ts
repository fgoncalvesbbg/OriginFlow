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
  assignPMToCategory,
  getProductFeatures,
  saveProductFeature,
  deleteProductFeature
} from './compliance-category.service';

export {
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
  unassignAttributeFromCategory
} from './compliance-requirement.service';

export { COMPLIANCE_SECTIONS, ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS } from '../../config/compliance.constants';
