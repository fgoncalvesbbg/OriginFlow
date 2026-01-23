/**
 * Modal types
 */

export interface ModalOptions {
  title?: string;
  message?: string;
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  isDangerous?: boolean;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

export interface ConfirmOptions extends ModalOptions {
  onConfirm?: () => void | Promise<void>;
  confirmText?: string;
}

export interface Modal {
  id: string;
  type: 'alert' | 'confirm' | 'custom';
  options: ModalOptions | ConfirmOptions;
  isOpen: boolean;
  isLoading: boolean;
}

export interface ModalContextType {
  modals: Modal[];
  alert: (options: ModalOptions) => string;
  confirm: (options: ConfirmOptions) => string;
  custom: (options: ModalOptions) => string;
  close: (id: string) => void;
  closeAll: () => void;
}
