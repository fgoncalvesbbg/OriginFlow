/**
 * Regulatory module — the regulation library, per-IM-template assignment, and the
 * AI regulatory check (migration 115).
 */

export {
  getRegulations,
  getRegulationById,
  createRegulation,
  updateRegulation,
  deleteRegulation,
  getRegulationUsageCounts,
  summaryByteLength,
  RegulationInUseError,
  MAX_SUMMARY_BYTES,
  SUMMARY_WARN_BYTES,
} from './regulation.service';

export {
  getTemplateRegulations,
  getTemplateRegulationCounts,
  assignRegulationToTemplate,
  updateTemplateRegulationNotes,
  unassignRegulationFromTemplate,
  derivedAssignmentId,
  isDerivedAssignmentId,
} from './regulation-assignment.service';

export { parseRegulationNotes, parseBulletLines } from './regulation-notes';

export {
  parseRegulationChecklist,
  checklistItemKey,
  buildTemplateChecklist,
  getChecklistState,
  setChecklistItemState,
  getTemplateChecklistState,
  setTemplateChecklistItemState,
  summarizeChecklist,
} from './regulation-checklist';
export type {
  ChecklistItem,
  ChecklistItemState,
  ChecklistItemStatus,
  ChecklistSummary,
} from './regulation-checklist';

export {
  findingKey,
  getFindingStatuses,
  setFindingStatus,
} from './regulation-finding-status';
export type { FindingStatus, FindingStatusEntry } from './regulation-finding-status';

export {
  buildRegCheckDocument,
  runRegulatoryCheck,
  getRegulatoryCheckHistory,
  verifyVerbatimPhrase,
  registerVerbatimFinding,
} from './regulatory-check.service';
export type { RegCheckProgress } from './regulatory-check.service';

export {
  serializeTemplateForRegCheck,
  chunkRegCheckDocument,
  htmlToStructuredText,
  REG_CHECK_BLOCK_CHAR_CAP,
  REG_CHECK_CHUNK_CHARS,
} from './regulatory-serialize';
export type {
  RegCheckDocument,
  RegCheckSection,
  RegCheckBlock,
  RegCheckBlockKind,
} from './regulatory-serialize';
