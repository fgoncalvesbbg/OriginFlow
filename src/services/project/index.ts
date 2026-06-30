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
  collapseSkuAttributeValues
} from './project-sku.service';

export {
  getSkusByCategory,
  getFlagsForSkus,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag
} from './sku-attribute-review.service';
export type { CategorySku } from './sku-attribute-review.service';
