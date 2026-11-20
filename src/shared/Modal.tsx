import type { ReactNode } from "react";

interface ModalProps {
  /** 内层面板的类名；遮罩与对话框语义由本组件统一提供。 */
  className: string;
  /** 点击遮罩（而非面板内部）时触发；不提供则遮罩点击无动作。 */
  onBackdropClick?: () => void;
  children: ReactNode;
}

export function Modal({ className, onBackdropClick, children }: ModalProps) {
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      // 用 mousedown 判定：在面板内按下、拖到遮罩上松开不算点击遮罩。
      onMouseDown={
        onBackdropClick
          ? (event) => {
              if (event.target === event.currentTarget) {
                onBackdropClick();
              }
            }
          : undefined
      }
    >
      <div className={className}>{children}</div>
    </div>
  );
}
