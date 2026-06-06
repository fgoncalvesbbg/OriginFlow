/**
 * Shared confirmation modal for destructive / confirmable actions.
 *
 * Consolidates three previously-duplicated copies (ProjectDetail, IMTemplateEditor,
 * ProjectIMGenerator). The `variant` controls the confirm button's color and default label:
 *   - 'primary' (default) → indigo button, "Confirm"
 *   - 'danger'            → rose button, "Delete"
 * Pass `confirmLabel` to override the text.
 */

import React from 'react';
import { Button } from './Button';

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'primary' | 'danger';
  confirmLabel?: string;
}

const DEFAULT_CONFIRM_LABEL: Record<'primary' | 'danger', string> = {
  primary: 'Confirm',
  danger: 'Delete',
};

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen, title, message, onConfirm, onCancel, variant = 'primary', confirmLabel,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel ?? DEFAULT_CONFIRM_LABEL[variant]}
          </Button>
        </div>
      </div>
    </div>
  );
};
