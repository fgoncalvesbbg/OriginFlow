/**
 * useModal hook
 * Custom hook for using modals/dialogs
 */

import { useContext } from 'react';
import { ModalContext } from '../context/ModalContext';
import { ModalContextType } from '../types/modal.types';

export const useModal = (): ModalContextType => {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
