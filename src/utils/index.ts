/**
 * Utilities module
 * Shared utility functions and helpers across the application
 */

export { generateUUID } from './uuid.utils';
export { handleError } from './error.utils';
export { sanitizeHtml } from './sanitize-html.utils';
export { PortalLockedError, asPortalLockedError, isPortalLockedError } from './portal-lockout.utils';
export { generateNumericCode } from './code.utils';
export { validateAttributeValue, getAttributesForCategory, getSupplierVisibleAttributes } from './attribute-validation.utils';
export { passesFeatureGate } from './attribute-condition.utils';
export { parseAttributeCsv } from './attribute-csv-import.utils';
export type { ParsedAttributeRow } from './attribute-csv-import.utils';
export { parseSkuCsv, parseSkuRoster } from './sku-csv-import.utils';
export type { SkuCsvSkuColumn, SkuCsvAttributeRow, SkuCsvRow, SkuCsvParseResult, SkuRosterParseResult } from './sku-csv-import.utils';
export { buildAkeneoRows, akeneoColumnCode } from './akeneo-export.utils';
export type { AkeneoExportRow } from './akeneo-export.utils';
