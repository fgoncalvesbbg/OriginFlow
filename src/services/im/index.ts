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
export type { ProjectIMSummary } from './project-im.service';

export {
  getIMBlocks,
  getIMBlockById,
  getIMBlockBySlug,
  saveIMBlock,
  deleteIMBlock,
  getIMBlockUsage,
  getIMBlockUsageCounts,
  BlockInUseError
} from './im-block.service';
export type { IMBlockUsageRef } from './im-block.service';

export { resolveManual, wrapBlockCallout, passesFeatureGate } from './im-resolver';
export { uploadIMAsset } from './im-asset.service';
export { publishResolvedManuals, normalizeResolverData, getPublishedManifestUrl } from './im-publish.service';
export type { PublishResult, PublishedLanguage } from './im-publish.service';
export {
  getStaleProjectIMKeys,
  getStaleProjectIMDetails,
  getProjectIMStaleReasons,
  isProjectIMStale,
  republishProjectIM,
  stalenessKey,
} from './im-staleness.service';
export type { StaleReason, StaleManual } from './im-staleness.service';
