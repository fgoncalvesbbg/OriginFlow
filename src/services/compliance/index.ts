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
  getCategoryTree,
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
  replaceCategoryAttributes,
  deleteCategoryAttribute,
  assignAttributeToCategory,
  unassignAttributeFromCategory,
  makeAttributeGlobal
} from './compliance-requirement.service';
export type { ImportAttributesResult, ReplaceAttributesResult } from './compliance-requirement.service';

export {
  getProductToolkitDefinitions,
  getProductToolkitDefinition,
  mapProductToolkitAttributes,
  ProductToolkitUnavailableError,
} from './producttoolkit-attributes.service';
export type { PtDefinitionSummary, PtAttribute } from './producttoolkit-attributes.service';

export { COMPLIANCE_SECTIONS, ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS } from '../../config/compliance.constants';
