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
  applyAttributeSync,
  getAttributeUsage,
  deleteCategoryAttribute,
  assignAttributeToCategory,
  unassignAttributeFromCategory,
  makeAttributeGlobal
} from './compliance-requirement.service';
export type { ImportAttributesResult, ReplaceAttributesResult, ApplySyncResult } from './compliance-requirement.service';
export { planAttributeSync, buildSyncWrite, usageTotal, emptyUsage, resolvesToGlobal } from './attribute-sync-plan';
export type { SyncPlan, SyncItem, SyncRisk, SyncAction, AttributeUsage } from './attribute-sync-plan';

export {
  getProductToolkitDefinitions,
  getProductToolkitDefinition,
  mapProductToolkitAttributes,
  ProductToolkitUnavailableError,
} from './producttoolkit-attributes.service';
export type { PtDefinitionSummary, PtAttribute } from './producttoolkit-attributes.service';

export { COMPLIANCE_SECTIONS, ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS, attributeGroupRank, compareAttributes, groupsInOrder } from '../../config/compliance.constants';
