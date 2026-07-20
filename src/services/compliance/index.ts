/**
 * Compliance module
 * Technical Compliance Framework (TCF) management
 */

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
  checkComplianceDeadlines
} from './compliance.service';

export {
  getCategories,
  saveCategory,
  deleteCategory,
  assignPMToCategory
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
  importCategoryAttributes,
  deleteCategoryAttribute,
  assignAttributeToCategory,
  unassignAttributeFromCategory,
  makeAttributeGlobal
} from './compliance-requirement.service';
export type { ImportAttributesResult } from './compliance-requirement.service';

export { COMPLIANCE_SECTIONS, ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS } from '../../config/compliance.constants';
