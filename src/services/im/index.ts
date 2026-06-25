/**
 * IM (Instruction Manual) module
 * Template management and project IM generation
 */

export {
  getIMTemplates,
  getIMTemplateById,
  getIMTemplateByCategoryId,
  createIMTemplate,
  updateIMTemplate
} from './im-template.service';

export {
  getIMSections,
  saveIMSection,
  deleteIMSection
} from './im-section.service';

export {
  getProjectIM,
  saveProjectIM,
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

export { resolveManual } from './im-resolver';
export { publishResolvedManuals, normalizeResolverData, getPublishedManifestUrl } from './im-publish.service';
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
  isPrintExportAvailable,
} from './im-print-export.service';
export type {
  RequestPrintPdfParams,
  PrintPdfResult,
  PrintCoverInput,
  PrintBackInput,
} from './im-print-export.service';
