import type { ReactNode } from "react";

interface ModalProps {
  /** 内层面板的类名；遮罩与对话框语义由本组件统一提供。 */
  className: string;
  children: ReactNode;
}

export function Modal({ className, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={className}>{children}</div>
    </div>
  );
}
