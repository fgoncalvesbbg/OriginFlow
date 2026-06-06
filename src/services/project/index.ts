/**
 * Project module
 * Core project management functionality including documents, steps, and milestones
 */

export {
  getProjects,
  getProjectById,
  getProjectByToken,
  getProjectsBySupplierId,
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
  getDocumentComments,
  addDocumentComment,
  getMissingDocumentsForSupplier
} from './project-document.service';

export { saveProjectMilestones as saveProjectMilestonesDirect } from './project-milestone.service';

export {
  createAttributeRequest,
  getAttributeRequestsByProject,
  getAttributeRequestsByProjectPublic,
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
