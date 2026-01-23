/**
 * useDebounce hook
 * Delays updating a value until after a specified delay with no changes
 * Useful for search input, autocomplete, API calls
 */

import { useState, useEffect } from 'react';

export const useDebounce = <T,>(value: T, delay: number = 500): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up the timeout
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clean up the timeout if value changes before delay is up
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
