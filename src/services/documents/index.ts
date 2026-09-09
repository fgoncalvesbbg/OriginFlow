/**
 * SOP & Documents service module.
 *
 * Everything here speaks HTTP to /api/doc* rather than to `db`. That is not an
 * inconsistency to tidy up later — see the header of document.service.ts.
 */

export {
  getDocuments,
  createDocument,
  updateDocument,
  getVersions,
  createVersion,
  finalizeVersion,
  unfinalizeVersion,
  getProjectBindings,
  bindDocumentToProject,
  unbindDocumentFromProject,
  latestVersionUrl,
} from './document.service';

export {
  getSupplierProjectDocuments,
  getInternalProjectDocuments,
  downloadDocument,
} from './document-portal.service';

export type { PortalCredentials } from './document-portal.service';
