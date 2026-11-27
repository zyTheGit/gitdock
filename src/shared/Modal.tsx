import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

interface ModalProps {
  /** 内层面板的类名；遮罩与对话框语义由本组件统一提供。 */
  className: string;
  /** 可访问名称；也可用 labelledBy 关联面板内标题。 */
  ariaLabel?: string;
  labelledBy?: string;
  /** 点击遮罩（而非面板内部）时触发；不提供则遮罩点击无动作。 */
  onBackdropClick?: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']), [contenteditable='true']";

function visibleFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

export function Modal({
  className,
  ariaLabel,
  labelledBy,
  onBackdropClick,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const previous = returnFocusRef.current;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (visibleFocusable(panel)[0] ?? panel).focus();
    }
    return () => previous?.focus();
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const items = visibleFocusable(panel);
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={panelRef}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={trapFocus}
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
