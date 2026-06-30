/**
 * Utilities module
 * Shared utility functions and helpers across the application
 */

export { generateUUID } from './uuid.utils';
export { handleError } from './error.utils';
export { sanitizeHtml } from './sanitize-html.utils';
export { generateNumericCode } from './code.utils';
export { validateAttributeValue, getAttributesForCategory } from './attribute-validation.utils';
export { passesFeatureGate } from './attribute-condition.utils';
