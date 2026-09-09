/**
 * Design Specs services. The supplier round itself lives in `src/services/review/` —
 * see design-spec.service.ts for why.
 */

export {
  designSpecSubject,
  canEditDesignSpecs,
  getDesignSpecs,
  getDesignSpecByProject,
  getDesignSpecVersions,
  getVersionsBySpec,
  getDesignSpecSkuIds,
  getDesignSpecDetail,
  createDesignSpec,
  updateDesignSpec,
  addDesignSpecVersion,
  issueDesignSpecFinal,
  unlockDesignSpec,
  cancelDesignSpec,
  reopenDesignSpec,
  setDesignSpecSkus,
} from './design-spec.service';

export { getDesignSpecRounds } from './design-spec-rounds.service';

export {
  designSpecReviewUrl,
  sendDesignSpecForReview,
  getDesignSpecReviewLinks,
  revokeDesignSpecReviewLink,
} from './design-spec-review.service';

export {
  MAX_SPEC_PDF_BYTES,
  fetchDesignSpecFileByToken,
  fetchDesignSpecFile,
  uploadDesignSpecVersion,
} from './design-spec-file.service';
export type { DesignSpecFile, UploadedVersionFiles } from './design-spec-file.service';

export { stampDraftPdf, readPageCount, asciiSafe } from './design-spec-stamp';

export {
  getDesignSpecNotes,
  getDesignSpecNoteReplies,
  setReviewCommentStatus,
  addReviewReply,
} from './design-spec-notes.service';
