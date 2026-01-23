/**
 * Modal component
 * Displays modals/dialogs with support for alert, confirm, and custom content
 */

import React, { useState } from 'react';
import { X, AlertTriangle, Info, CheckCircle } from 'lucide-react';
import { Modal as ModalType, ConfirmOptions } from '../../types/modal.types';

interface ModalComponentProps {
  modal: ModalType;
  onClose: (id: string) => void;
}

const ModalComponent: React.FC<ModalComponentProps> = ({ modal, onClose }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsLoading(true);
      const options = modal.options as ConfirmOptions;
      if (options.onConfirm) {
        await options.onConfirm();
      } else if (options.onOk) {
        await options.onOk();
      }
      onClose(modal.id);
    } catch (error) {
      console.error('Modal action error:', error);
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    try {
      if (modal.options.onCancel) {
        await modal.options.onCancel();
      }
      onClose(modal.id);
    } catch (error) {
      console.error('Modal cancel error:', error);
    }
  };

  const getIcon = () => {
    if (modal.options.isDangerous) {
      return <AlertTriangle className="w-6 h-6 text-rose-600" />;
    }
    if (modal.type === 'alert') {
      return <Info className="w-6 h-6 text-indigo-600" />;
    }
    return <CheckCircle className="w-6 h-6 text-emerald-600" />;
  };

  const getIconBg = () => {
    if (modal.options.isDangerous) return 'bg-rose-100';
    if (modal.type === 'alert') return 'bg-indigo-100';
    return 'bg-emerald-100';
  };

  const title = modal.options.title || (modal.type === 'alert' ? 'Alert' : 'Confirm');
  const okText = (modal.options as any).okText || (modal.options as any).confirmText || 'OK';
  const cancelText = modal.options.cancelText || 'Cancel';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40 animate-fadeIn"
        onClick={() => onClose(modal.id)}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4 animate-fadeIn">
        <div className="bg-white rounded-xl shadow-lg max-w-sm w-full overflow-hidden border border-gray-200">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${getIconBg()}`}>
                {getIcon()}
              </div>
              <h2 className="text-lg font-bold text-primary">{title}</h2>
            </div>
            <button
              onClick={() => onClose(modal.id)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            {modal.options.content ? (
              <div>{modal.options.content}</div>
            ) : (
              <p className="text-gray-700 leading-relaxed">
                {modal.options.message}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="bg-light px-6 py-4 flex gap-3 justify-end border-t border-gray-100">
            {modal.type === 'confirm' || modal.type === 'custom' ? (
              <>
                <button
                  onClick={handleCancel}
                  disabled={isLoading}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
                >
                  {cancelText}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isLoading}
                  className={`px-4 py-2 text-white rounded-xl font-medium transition-colors disabled:opacity-50 ${
                    modal.options.isDangerous
                      ? 'bg-rose-600 hover:bg-rose-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {isLoading ? 'Loading...' : okText}
                </button>
              </>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={isLoading}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : okText}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

interface ModalContainerProps {
  modals: ModalType[];
  onClose: (id: string) => void;
}

export const ModalContainer: React.FC<ModalContainerProps> = ({ modals, onClose }) => {
  return (
    <>
      {modals.map(modal => (
        <ModalComponent key={modal.id} modal={modal} onClose={onClose} />
      ))}
    </>
  );
};
