/**
 * IM (Instruction Manual) module
 * Template management and project IM generation
 */

export {
  getIMTemplates,
  getIMTemplateById,
  getIMTemplateByCategoryId,
  createIMTemplate,
  updateIMTemplate,
  deleteIMTemplate,
  getProjectIMCountForTemplate,
  getOrCreateBlankTemplate,
  BLANK_TEMPLATE_NAME
} from './im-template.service';

export {
  getIMSections,
  saveIMSection,
  deleteIMSection
} from './im-section.service';

export {
  getProjectIM,
  saveProjectIM,
  updateProjectIMPlaceholders,
  setProjectIMFinalized,
  deleteProjectIM,
  getAllProjectIMs
} from './project-im.service';

export {
  getIMBlocks,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsageCounts,
  BlockInUseError
} from './im-block.service';

export {
  getAssetFolders,
  createAssetFolder,
  renameAssetFolder,
  deleteAssetFolder,
  getAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  backfillAssetsFromStorage,
} from './im-asset-library.service';

export { resolveManual, TEMP_HIGHLIGHT_CLASS, containsTempHighlight, findTempHighlightSections } from './im-resolver';
export { publishResolvedManuals, normalizeResolverData, getPublishedManifestUrl, getProjectRequiredLanguages } from './im-publish.service';
export type { PublishResult } from './im-publish.service';
export {
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  republishProjectIM,
  stalenessKey,
} from './im-staleness.service';
export type { StaleReason, StaleManual } from './im-staleness.service';
export {
  requestPrintPdf,
  getPrintPdfUrl,
  getPrintRenders,
  isPrintExportAvailable,
} from './im-print-export.service';
export type {
  RequestPrintPdfParams,
  PrintPdfResult,
  PrintCoverInput,
  PrintBackInput,
  PrintRender,
} from './im-print-export.service';
export {
  getIMShares,
  createIMShare,
  revokeIMShare,
  resolveIMShareToken,
  getIMShareUrl,
} from './im-share.service';
export type { IMShare } from './im-share.service';
export {
  validateImImport,
  importIMTemplate,
  buildExtraSectionsFromDoc,
  importProjectIMFromDoc,
  exportTemplateForReview,
  importSupplierDraftIntoProject,
} from './im-import.service';
export type {
  ImImportDoc,
  ImImportSection,
  ImImportBlock,
  ImImportBlockType,
  ImImportScope,
  ImImportMatchStatus,
  ImImportImageNeed,
  ImImportValidation,
  ImImportResult,
  ImProjectImportResult,
  TemplateReviewSection,
  TemplateReviewExport,
  ImSupplierDiffImportResult,
} from './im-import.service';
