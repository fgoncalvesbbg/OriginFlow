/**
 * useToast hook
 * Custom hook for using toast notifications
 */

import { useContext } from 'react';
import { ToastContext } from '../context/ToastContext';
import { ToastContextType } from '../types/toast.types';

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context;
};
