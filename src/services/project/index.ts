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
