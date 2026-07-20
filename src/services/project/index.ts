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
  updateStepStatus
} from './project-step.service';

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
  getMissingDocumentsForSupplier
} from './project-document.service';

export {
  createAttributeRequest,
  getAttributeRequestsByProject,
  getAttributeRequestsByProjectPublic,
  getAttributeRequestsForSupplier,
  getAttributeRequestByToken,
  submitAttributeRequest,
  updateAttributeRequestData,
  deleteAttributeRequest
} from './project-attribute-request.service';

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
  getCatalogSkus,
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
  getFlagsForSkus,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag
} from './sku-attribute-review.service';
export type { CategorySku } from './sku-attribute-review.service';
