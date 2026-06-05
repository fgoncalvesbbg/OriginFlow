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

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'primary' | 'danger';
  confirmLabel?: string;
}

const CONFIRM_BUTTON_CLASSES: Record<'primary' | 'danger', string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  danger: 'bg-rose-600 text-white hover:bg-red-700',
};

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
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className={`px-4 py-2 rounded text-sm font-medium ${CONFIRM_BUTTON_CLASSES[variant]}`}>
            {confirmLabel ?? DEFAULT_CONFIRM_LABEL[variant]}
          </button>
        </div>
      </div>
    </div>
  );
};
