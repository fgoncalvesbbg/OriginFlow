/**
 * useForm hook
 * Custom hook for managing form state, validation, and submission
 */

import { useState, useCallback } from 'react';
import { ValidationResult } from '../utils/validators.utils';

export interface FormFieldError {
  [fieldName: string]: string[];
}

export interface UseFormOptions<T> {
  initialValues: T;
  onSubmit: (values: T) => Promise<void> | void;
  validate?: (values: T) => FormFieldError;
}

export interface UseFormReturn<T> {
  values: T;
  errors: FormFieldError;
  isSubmitting: boolean;
  touched: { [key in keyof T]?: boolean };
  setFieldValue: (field: keyof T, value: any) => void;
  setFieldError: (field: keyof T, errors: string[]) => void;
  setFieldTouched: (field: keyof T, touched: boolean) => void;
  handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  resetForm: () => void;
  clearErrors: () => void;
  hasErrors: boolean;
}

export const useForm = <T extends Record<string, any>>({
  initialValues,
  onSubmit,
  validate
}: UseFormOptions<T>): UseFormReturn<T> => {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FormFieldError>({});
  const [touched, setTouched] = useState<{ [key in keyof T]?: boolean }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setFieldValue = useCallback((field: keyof T, value: any) => {
    setValues(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear error for this field when user starts typing
    if (errors[field as string]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field as string];
        return newErrors;
      });
    }
  }, [errors]);

  const setFieldError = useCallback((field: keyof T, fieldErrors: string[]) => {
    setErrors(prev => ({
      ...prev,
      [field]: fieldErrors
    }));
  }, []);

  const setFieldTouched = useCallback((field: keyof T, isTouched: boolean) => {
    setTouched(prev => ({
      ...prev,
      [field]: isTouched
    }));
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name, value, type } = e.target;
      const finalValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
      setFieldValue(name as keyof T, finalValue);
    },
    [setFieldValue]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const { name } = e.target;
      setFieldTouched(name as keyof T, true);
    },
    [setFieldTouched]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // Validate if validate function provided
      if (validate) {
        const validationErrors = validate(values);
        if (Object.keys(validationErrors).length > 0) {
          setErrors(validationErrors);
          return;
        }
      }

      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } catch (error) {
        console.error('Form submission error:', error);
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, validate, onSubmit]
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  const hasErrors = Object.keys(errors).length > 0;

  return {
    values,
    errors,
    isSubmitting,
    touched,
    setFieldValue,
    setFieldError,
    setFieldTouched,
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    clearErrors,
    hasErrors
  };
};
