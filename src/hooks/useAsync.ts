/**
 * useAsync hook
 * Custom hook for handling asynchronous operations with loading and error states
 */

import { useEffect, useState, useCallback, useRef } from 'react';

export type AsyncStatus = 'idle' | 'pending' | 'success' | 'error';

export interface UseAsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

export interface UseAsyncReturn<T> extends UseAsyncState<T> {
  execute: () => Promise<T>;
  reset: () => void;
}

export const useAsync = <T,>(
  asyncFunction: () => Promise<T>,
  immediate: boolean = true
): UseAsyncReturn<T> => {
  const [state, setState] = useState<UseAsyncState<T>>({
    status: 'idle',
    data: null,
    error: null,
    isLoading: false
  });

  const isMountedRef = useRef(true);

  const execute = useCallback(async (): Promise<T> => {
    setState({
      status: 'pending',
      data: null,
      error: null,
      isLoading: true
    });

    try {
      const response = await asyncFunction();

      if (isMountedRef.current) {
        setState({
          status: 'success',
          data: response,
          error: null,
          isLoading: false
        });
      }

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (isMountedRef.current) {
        setState({
          status: 'error',
          data: null,
          error: err,
          isLoading: false
        });
      }

      throw err;
    }
  }, [asyncFunction]);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      data: null,
      error: null,
      isLoading: false
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (immediate) {
      execute();
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [execute, immediate]);

  return {
    ...state,
    execute,
    reset
  };
};
