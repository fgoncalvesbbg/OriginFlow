/**
 * Form validation utilities
 * Common validation functions for forms
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate email address
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 */
export const validatePassword = (password: string): ValidationResult => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate required field
 */
export const validateRequired = (value: string | undefined | null, fieldName: string): ValidationResult => {
  if (!value || value.trim().length === 0) {
    return {
      valid: false,
      errors: [`${fieldName} is required`]
    };
  }
  return { valid: true, errors: [] };
};

/**
 * Validate field length
 */
export const validateLength = (
  value: string,
  min: number,
  max: number,
  fieldName: string
): ValidationResult => {
  const errors: string[] = [];

  if (value.length < min) {
    errors.push(`${fieldName} must be at least ${min} characters`);
  }

  if (value.length > max) {
    errors.push(`${fieldName} must be no more than ${max} characters`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate number field
 */
export const validateNumber = (value: string, fieldName: string): ValidationResult => {
  if (isNaN(Number(value))) {
    return {
      valid: false,
      errors: [`${fieldName} must be a valid number`]
    };
  }
  return { valid: true, errors: [] };
};

/**
 * Validate number range
 */
export const validateNumberRange = (
  value: number,
  min: number,
  max: number,
  fieldName: string
): ValidationResult => {
  const errors: string[] = [];

  if (value < min) {
    errors.push(`${fieldName} must be at least ${min}`);
  }

  if (value > max) {
    errors.push(`${fieldName} must be no more than ${max}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate file
 */
export const validateFile = (
  file: File | null | undefined,
  maxSizeKB: number = 10240,
  allowedMimeTypes?: string[]
): ValidationResult => {
  const errors: string[] = [];

  if (!file) {
    errors.push('File is required');
    return { valid: false, errors };
  }

  // Check file size
  const fileSizeKB = file.size / 1024;
  if (fileSizeKB > maxSizeKB) {
    errors.push(`File size must be less than ${maxSizeKB}KB (current: ${Math.round(fileSizeKB)}KB)`);
  }

  // Check mime type
  if (allowedMimeTypes && !allowedMimeTypes.includes(file.type)) {
    errors.push(`File type must be one of: ${allowedMimeTypes.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate URL
 */
export const validateUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate phone number (basic)
 */
export const validatePhoneNumber = (phone: string): boolean => {
  const phoneRegex = /^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Validate date (YYYY-MM-DD format)
 */
export const validateDate = (dateString: string): ValidationResult => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (!dateRegex.test(dateString)) {
    return {
      valid: false,
      errors: ['Date must be in YYYY-MM-DD format']
    };
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return {
      valid: false,
      errors: ['Date is invalid']
    };
  }

  return { valid: true, errors: [] };
};

/**
 * Validate date is in the future
 */
export const validateFutureDate = (dateString: string, fieldName: string = 'Date'): ValidationResult => {
  const dateValidation = validateDate(dateString);
  if (!dateValidation.valid) {
    return dateValidation;
  }

  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date < today) {
    return {
      valid: false,
      errors: [`${fieldName} must be in the future`]
    };
  }

  return { valid: true, errors: [] };
};

/**
 * Combine multiple validation results
 */
export const combineValidations = (...results: ValidationResult[]): ValidationResult => {
  const allErrors = results.flatMap(r => r.errors);
  return {
    valid: allErrors.length === 0,
    errors: allErrors
  };
};
