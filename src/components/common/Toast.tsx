/**
 * Toast component
 * Displays toast notifications
 */

import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { Toast as ToastType } from '../../types/toast.types';

interface ToastComponentProps {
  toast: ToastType;
  onClose: (id: string) => void;
}

const ToastComponent: React.FC<ToastComponentProps> = ({ toast, onClose }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (!toast.duration) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
    }, toast.duration - 300); // Start fade-out 300ms before removal

    return () => clearTimeout(timer);
  }, [toast.duration]);

  if (!isVisible) return null;

  const bgColor = {
    success: 'bg-emerald-50 border-emerald-200',
    error: 'bg-rose-50 border-rose-200',
    info: 'bg-indigo-50 border-indigo-200',
    warning: 'bg-amber-50 border-amber-200'
  }[toast.type];

  const textColor = {
    success: 'text-emerald-800',
    error: 'text-rose-800',
    info: 'text-indigo-800',
    warning: 'text-amber-800'
  }[toast.type];

  const icon = {
    success: <CheckCircle className="w-5 h-5 text-emerald-600" />,
    error: <AlertCircle className="w-5 h-5 text-rose-600" />,
    info: <Info className="w-5 h-5 text-indigo-600" />,
    warning: <AlertTriangle className="w-5 h-5 text-amber-600" />
  }[toast.type];

  return (
    <div
      className={`${bgColor} border rounded-xl p-4 flex items-start gap-3 animate-slideUp shadow-lg`}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-grow">
        <p className={`${textColor} font-medium`}>
          {toast.message}
        </p>
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onClose(toast.id), 300);
        }}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Close notification"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastType[];
  onClose: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onClose }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastComponent toast={toast} onClose={onClose} />
        </div>
      ))}
    </div>
  );
};
