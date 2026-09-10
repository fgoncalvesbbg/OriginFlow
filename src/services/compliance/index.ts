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
  reorderComplianceSections,
  reorderRequirements,
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
  DEFAULT_SECTION_NAME,
  sectionOf,
  orderSectionNames,
  orderRequirements,
  groupRequirementsBySection,
  reorderPlan,
  moveInList,
  nextSortOrder,
} from './requirement-order';
export type { RequirementSectionGroup } from './requirement-order';

export {
  getComplianceQuestions,
  getComplianceQuestionsOrThrow,
  saveComplianceQuestion,
  deleteComplianceQuestion,
} from './compliance-question.service';

export {
  conditionQuestionId,
  isConditional,
  questionsForRequirements,
  evaluateRequirementApplicability,
  describeQuestionCondition,
  questionUsageCounts,
} from './tcf-condition';
export type {
  TcfAnswers, ApplicabilityReason, ApplicabilityVerdict, ApplicabilityResult,
} from './tcf-condition';

export {
  applyRequirementSharing, unlinkRequirementFromCategory, promoteRequirementToGlobal,
  setRequirementApplicability, setRequirementExclusions,
} from './requirement-sharing.service';
export type { ApplySharingResult } from './requirement-sharing.service';
export { planRequirementSharing, summarizeSharingPlan, SHARING_SKIP_LABELS } from './requirement-sharing-plan';
export type {
  SharingMode, SharingPlan, SharingSkipReason,
  PlannedLink, PlannedCopy, PlannedSkip, PlannedBlock,
} from './requirement-sharing-plan';

export {
  getRequirementHistory,
  lockCategoryRequirements,
  releaseCategoryRequirements,
  canReleaseComplianceCategory,
  isValidReleaseReason,
  RELEASE_REASON_MIN_LENGTH,
} from './compliance-lock.service';

export {
  getProductToolkitDefinitions,
  getProductToolkitDefinition,
  mapProductToolkitAttributes,
  ProductToolkitUnavailableError,
} from './producttoolkit-attributes.service';
export type { PtDefinitionSummary, PtAttribute } from './producttoolkit-attributes.service';

export { COMPLIANCE_SECTIONS, ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS, attributeGroupRank, compareAttributes, groupsInOrder } from '../../config/compliance.constants';
