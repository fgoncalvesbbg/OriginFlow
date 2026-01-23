/**
 * Modal context provider
 * Manages global modals/dialogs across the application
 */

import React, { createContext, useState, useCallback, ReactNode } from 'react';
import { Modal, ModalContextType, ModalOptions, ConfirmOptions } from '../types/modal.types';
import { generateUUID } from '../utils';

export const ModalContext = createContext<ModalContextType | undefined>(undefined);

interface ModalProviderProps {
  children: ReactNode;
}

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
  const [modals, setModals] = useState<Modal[]>([]);

  const addModal = useCallback(
    (type: 'alert' | 'confirm' | 'custom', options: ModalOptions | ConfirmOptions): string => {
      const id = generateUUID();
      const modal: Modal = {
        id,
        type,
        options,
        isOpen: true,
        isLoading: false
      };

      setModals(prev => [...prev, modal]);
      return id;
    },
    []
  );

  const close = useCallback((id: string) => {
    setModals(prev => {
      const modal = prev.find(m => m.id === id);
      if (modal?.options.onClose) {
        modal.options.onClose();
      }
      return prev.filter(m => m.id !== id);
    });
  }, []);

  const closeAll = useCallback(() => {
    setModals([]);
  }, []);

  const alert = useCallback(
    (options: ModalOptions) => addModal('alert', options),
    [addModal]
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => addModal('confirm', options),
    [addModal]
  );

  const custom = useCallback(
    (options: ModalOptions) => addModal('custom', options),
    [addModal]
  );

  const value: ModalContextType = {
    modals,
    alert,
    confirm,
    custom,
    close,
    closeAll
  };

  return (
    <ModalContext.Provider value={value}>
      {children}
    </ModalContext.Provider>
  );
};
