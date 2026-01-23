/**
 * useConfirm hook
 * Convenient hook for showing confirmation dialogs
 * Wrapper around useModal for easier usage
 */

import { useCallback } from 'react';
import { useModal } from './useModal';
import { ConfirmOptions } from '../types/modal.types';

export const useConfirm = () => {
  const modal = useModal();

  return useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        const modalId = modal.confirm({
          title: options.title || 'Confirm',
          message: options.message || 'Are you sure?',
          confirmText: options.confirmText || 'Yes',
          cancelText: options.cancelText || 'No',
          isDangerous: options.isDangerous || false,
          onConfirm: async () => {
            if (options.onConfirm) {
              await options.onConfirm();
            }
            resolve(true);
          },
          onCancel: () => {
            if (options.onCancel) {
              options.onCancel();
            }
            resolve(false);
          }
        });
      });
    },
    [modal]
  );
};
