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
  getRegulationTcfCounts,
  summaryByteLength,
  RegulationInUseError,
  MAX_SUMMARY_BYTES,
  SUMMARY_WARN_BYTES,
} from './regulation.service';

// Version identity (migration 139): deriving a CELEX from a citation, and asking EUR-Lex
// whether a newer consolidated version exists.
export { deriveCelex, eurLexUrl, isValidCelex, consolidatedDate } from './celex';
export type { CelexActType, DerivedCelex } from './celex';
export {
  runVersionCheck,
  knownVersionDate,
  versionCheckAgeDays,
  isReviewOverdue,
} from './regulation-version.service';
export type { VersionCheckOutcome } from './regulation-version.service';

export {
  getTemplateRegulations,
  getTemplateRegulationCounts,
  assignRegulationToTemplate,
  updateTemplateRegulationNotes,
  unassignRegulationFromTemplate,
  derivedAssignmentId,
  isDerivedAssignmentId,
} from './regulation-assignment.service';

// Importing a researched regulation (OriginFlow Regulation Import v1).
export {
  validateRegulationImport,
  planRegulationImport,
  applyRegulationImport,
  findExistingRegulation,
  toRegulationInput,
  diffStructure,
  REGULATION_IMPORT_SCHEMA_VERSION,
} from './regulation-import.service';
export type {
  RegulationImportDoc,
  RegulationImportClause,
  RegulationImportObligation,
  RegulationImportTcfRequirement,
  RegulationImportValidation,
  RegulationImportPlan,
  RegulationImportResult,
} from './regulation-import.service';

// Clauses and obligations (migration 141): the two levels below a regulation.
export {
  getRegulationStructures,
  getRegulationStructure,
  createClause,
  updateClause,
  deleteClause,
  createObligation,
  updateObligation,
  deleteObligation,
  clauseSortKey,
  inferClauseKind,
  compareClauses,
} from './regulation-clause.service';
export {
  CARRIERS,
  parseObligationLine,
  parseObligationBlock,
  parseCarriers,
  normalizeClause,
  toCarrier,
  appliesToIM,
} from './obligation-parse';
export type { ParsedObligation, Carrier } from './obligation-parse';

// Lifecycle (migration 140): what 'expired' means, and when it stops a publish or a request.
export {
  resolveReplacement,
  resolveEffective,
  isBlocking,
  collectBlocks,
  describeBlock,
  summarizeBlocks,
  indexRegulations,
  MAX_REPLACEMENT_DEPTH,
} from './regulation-lifecycle';
export type {
  RegulationBlock,
  ReplacementOutcome,
  ReplacementResolution,
} from './regulation-lifecycle';

export { getRegulationUsage } from './regulation-usage.service';
export type { RegulationUsage, RegulationTemplateUse } from './regulation-usage.service';

export { parseRegulationNotes, parseBulletLines } from './regulation-notes';

export {
  parseRegulationChecklist,
  checklistItemKey,
  buildTemplateChecklist,
  groupChecklistByRegulation,
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
  ChecklistRegulationGroup,
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
