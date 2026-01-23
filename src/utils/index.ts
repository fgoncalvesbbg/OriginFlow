/**
 * Utilities module
 * Shared utility functions and helpers across the application
 */

export { generateUUID } from './uuid.utils';
export { handleError } from './error.utils';
export {
  mapProfile,
  mapProject,
  mapProjectStep,
  mapProjectDocument,
  mapSupplier,
  mapComplianceRequest,
  mapProductionUpdate,
  mapRFQ
} from './mappers.utils';
export {
  validateEmail,
  validatePassword,
  validateRequired,
  validateLength,
  validateNumber,
  validateNumberRange,
  validateFile,
  validateUrl,
  validatePhoneNumber,
  validateDate,
  validateFutureDate,
  combineValidations
} from './validators.utils';

export type { ValidationResult } from './validators.utils';
