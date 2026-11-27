import { useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "../i18n";
import { BOTTOM_PANEL_SELECTOR } from "../shared/esc";
import { useEscClose } from "../shared/useEscClose";
import {
  RepositorySidebar,
  type RepositorySidebarProps,
} from "./RepositorySidebar";

export interface RefsPopoverProps extends Omit<
  RepositorySidebarProps,
  "id" | "className" | "width" | "filterInputRef" | "onNavigated"
> {
  id: string;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement>;
}

/** 非模态引用浮层：内容完全复用 RepositorySidebar，位置由标签栏后的零高锚点决定。 */
export function RefsPopover({
  id,
  open,
  onClose,
  triggerRef,
  ...sidebarProps
}: RefsPopoverProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [bottomPanelFocused, setBottomPanelFocused] = useState(false);
  const titleId = `${id}-title`;

  useEffect(() => {
    if (!open) {
      return;
    }
    filterInputRef.current?.focus();
    return () => triggerRef.current?.focus({ preventScroll: true });
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const syncBottomFocus = () => {
      const active = document.activeElement;
      setBottomPanelFocused(
        active instanceof HTMLElement && active.closest(BOTTOM_PANEL_SELECTOR) != null,
      );
    };
    syncBottomFocus();
    document.addEventListener("focusin", syncBottomFocus);
    return () => document.removeEventListener("focusin", syncBottomFocus);
  }, [open]);

  // 复用既有 Esc 层栈：后打开的内层 Modal 优先消费；底部面板聚焦时本层让路。
  useEscClose(onClose, !open || bottomPanelFocused);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose, triggerRef]);

  if (!open) {
    return null;
  }

  return (
    <div className="refs-popover-anchor">
      <section
        ref={panelRef}
        id={id}
        className="refs-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
      >
        <header className="refs-popover-header">
          <h2 id={titleId}>{t("shell.refsLabel")}</h2>
          <button
            type="button"
            className="refs-popover-close"
            onClick={onClose}
            title={t("shell.closeRefsTitle")}
            aria-label={t("shell.closeRefsTitle")}
          >
            ×
          </button>
        </header>
        <RepositorySidebar
          {...sidebarProps}
          id={`${id}-sidebar`}
          className="refs-popover-sidebar"
          width="100%"
          filterInputRef={filterInputRef}
          onNavigated={onClose}
        />
      </section>
    </div>
  );
}
