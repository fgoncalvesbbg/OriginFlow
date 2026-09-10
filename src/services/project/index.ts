/**
 * Project module
 * Core project management functionality including documents, steps, and milestones
 */

export {
  getProjects,
  getProjectById,
  getProjectByToken,
  getProjectsBySupplierToken,
  createProject,
  updateProject,
  deleteProject,
  saveProjectMilestones
} from './project.service';

export {
  getProjectSteps,
  getStepsForProjects,
  updateStepStatus,
  setStepStatuses
} from './project-step.service';

export {
  getProjectTemplates,
  getDefaultProjectTemplate,
  saveProjectTemplate,
  deleteProjectTemplate,
  setDefaultProjectTemplate,
  getTemplateSteps,
  saveTemplateStep,
  deleteTemplateStep,
  getTemplateDocuments,
  saveTemplateDocument,
  deleteTemplateDocument,
  getDefaultTemplateStructure
} from './project-template.service';

export {
  getProjectDocs,
  addDocument,
  updateDocumentMetadata,
  updateDocStatus,
  removeDocument,
  uploadFile,
  uploadAdHocFile,
  deleteDocumentVersion,
  addDocumentComment,
  addSupplierDocumentComment,
  getMissingDocumentsForSupplier,
  setSupplierPdfDocument,
  supplierPdfDocTitle,
  generatedDocTitle,
  GENERATED_DOC_STEP
} from './project-document.service';

export {
  createAttributeRequest,
  getAttributeRequestsByProject,
  getAttributeRequestsByProjectPublic,
  getAttributeRequestsForSupplier,
  getAttributeRequestByToken,
  getSiblingAttributeRequests,
  getAttributeRequestsByBatchToken,
  submitAttributeRequest,
  submitAttributeBatch,
  updateAttributeRequestData,
  deleteAttributeRequest
} from './project-attribute-request.service';
export type { SiblingAttributeRequest } from './project-attribute-request.service';

export {
  MAX_SKUS_PER_PROJECT,
  getProjectSkus,
  createProjectSku,
  updateProjectSku,
  deleteProjectSku,
  getEffectiveSkuValue,
  collapseSkuAttributeValues,
  mapProjectSku
} from './project-sku.service';

export {
  createCatalogSku,
  bulkUpsertCatalogSkus
} from './sku-catalog.service';
export type { ParsedSkuRow, BulkUpsertSkuResult } from './sku-catalog.service';

export {
  setSkuFinal,
  logSkuChanges,
  logSkuCreated,
  logSkuDeleted,
  markSkusExported,
  getSkuChangeLog
} from './sku-log.service';
export type { ChangeActor, SkuFieldChange } from './sku-log.service';

export {
  getSkusByCategory,
  getCategorySkuIndex,
  getFlagsForSkus,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag
} from './sku-attribute-review.service';
export type { CategorySku, CategorySkuSummary } from './sku-attribute-review.service';

export {
  getValuesForSkus,
  getValuesForAttribute,
  getClearedAttributeIds,
  setSkuAttributeValue,
  clearSkuAttributeValue,
  bulkSetSkuAttributeValue,
  copySkuAttributeValues,
  syncValueRowsFromJsonb,
  isValueStoreAvailable,
  mapSkuAttributeValue
} from './sku-attribute-value.service';
export type { ValueActor, BulkWriteResult } from './sku-attribute-value.service';

export { lookupEprelRecords } from './eprel.service';
export type { EprelLookupResult } from './eprel.service';

export {
  lookupJiraIssues,
  lookupJiraIssue,
  jiraFilterValue,
  JIRA_NOT_FOUND_LABEL
} from './jira.service';
export type { JiraLookupResponse } from './jira.service';
