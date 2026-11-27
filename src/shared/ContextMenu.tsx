import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscClose } from "./useEscClose";

export interface MenuItem {
  label: string;
  disabled?: boolean;
  /** 破坏性操作：label 用危险色显示（例如重写历史的重置）。 */
  danger?: boolean;
  /** 在该项上方绘制分隔线，用于区分操作分组。 */
  dividerBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEscClose(onClose);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    setPos({
      left: Math.min(Math.max(VIEWPORT_MARGIN, x), maxLeft),
      top: Math.min(Math.max(VIEWPORT_MARGIN, y), maxTop),
    });
  }, [x, y, items.length]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.dividerBefore && <div className="context-menu-divider" role="separator" />}
          <button
            role="menuitem"
            className={item.danger ? "danger-text" : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
