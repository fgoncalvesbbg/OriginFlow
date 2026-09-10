/**
 * Utilities module
 * Shared utility functions and helpers across the application
 */

export { generateUUID } from './uuid.utils';
export { handleError } from './error.utils';
export { sanitizeHtml } from './sanitize-html.utils';
export { PortalLockedError, asPortalLockedError } from './portal-lockout.utils';
export { generateNumericCode } from './code.utils';
export { validateAttributeValue, getAttributesForCategory, getSupplierVisibleAttributes } from './attribute-validation.utils';
export {
  requirementAppliesToCategory,
  getRequirementsForCategory,
  getRequirementsFrozenByCategory,
  requirementShareCount,
  getExcludedRequirementsForCategory,
  requirementExclusionCount,
  finalCategoriesForRequirement,
} from './requirement-scope.utils';
export {
  NO_VALUES,
  cellKey,
  indexByCell,
  validationModeFor,
  isInvalidValue,
  classifyCell,
  isFilled,
  isFillTarget,
  coverageFor,
  planBulkFill,
  planCopyFrom,
  planJsonbSync,
  toJsonbMirror,
} from './sku-attribute-value.utils';
export type {
  AttributeCoverage,
  BulkOutcome,
  BulkTarget,
  CopyPlanEntry,
  FillableSku,
  JsonbSyncPlan,
} from './sku-attribute-value.utils';
export { passesFeatureGate } from './attribute-condition.utils';
export { parseAttributeCsv } from './attribute-csv-import.utils';
export type { ParsedAttributeRow } from './attribute-csv-import.utils';
export { parseSkuCsv, parseSkuRoster } from './sku-csv-import.utils';
export type { SkuCsvSkuColumn, SkuCsvAttributeRow, SkuCsvRow, SkuCsvParseResult, SkuRosterParseResult, SkuSheetOrientation, ParseSkuCsvOptions } from './sku-csv-import.utils';
export { akeneoColumnCode } from './akeneo-export.utils';
export { formatBytes, formatDate } from './format.utils';
export type { FormatBytesOptions, FormatDateOptions } from './format.utils';
export { escapeHtmlAttr, escapeHtmlText } from './html-escape.utils';
export { downloadBlob } from './download.utils';
