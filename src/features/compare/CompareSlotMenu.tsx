import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { useEscClose } from "../../shared/useEscClose";

interface CompareSlotMenuProps {
  slotTitle: string;
  worktreeSelected: boolean;
  worktreeBlocked: boolean;
  onPickWorktree: () => void;
}

interface MenuPanelProps {
  id: string;
  menuLabel: string;
  itemLabel: string;
  actionLabel: string;
  disabled: boolean;
  onClose: () => void;
  onSelect: () => void;
}

function enabledItems(menu: HTMLDivElement | null): HTMLButtonElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
  );
}

function MenuPanel({
  id,
  menuLabel,
  itemLabel,
  actionLabel,
  disabled,
  onClose,
  onSelect,
}: MenuPanelProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEscClose(onClose);

  useEffect(() => {
    const menu = menuRef.current;
    const first = enabledItems(menu)[0];
    (first ?? menu)?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = enabledItems(event.currentTarget);
    if (items.length === 0) {
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : (current + 1) % items.length;
        break;
      case "ArrowUp":
        next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      id={id}
      ref={menuRef}
      className="compare-slot-menu-panel"
      role="menu"
      aria-label={menuLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="menuitem"
        className="compare-slot-menu-item"
        disabled={disabled}
        title={actionLabel}
        aria-label={actionLabel}
        onClick={() => {
          onClose();
          onSelect();
        }}
      >
        {itemLabel}
      </button>
    </div>
  );
}

/** 槽位低频操作：工作区选择；Escape 只收起菜单并把焦点还给触发按钮。 */
export function CompareSlotMenu({
  slotTitle,
  worktreeSelected,
  worktreeBlocked,
  onPickWorktree,
}: CompareSlotMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const disabled = worktreeSelected || worktreeBlocked;
  const menuLabel = t("compare.slotMenuLabel", { title: slotTitle });
  const actionLabel = worktreeSelected
    ? t("compare.worktreeSelected")
    : worktreeBlocked
      ? t("compare.worktreeBlocked")
      : t("compare.useWorktree");

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="compare-slot-menu"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="compare-slot-menu-trigger"
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
          }
          event.preventDefault();
          if (open) {
            const items = enabledItems(rootRef.current);
            const target = event.key === "ArrowUp" ? items[items.length - 1] : items[0];
            (target ?? rootRef.current?.querySelector<HTMLDivElement>('[role="menu"]'))?.focus();
          } else {
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <MenuPanel
          id={menuId}
          menuLabel={menuLabel}
          itemLabel={t("compare.worktreeShort")}
          actionLabel={actionLabel}
          disabled={disabled}
          onClose={() => close(true)}
          onSelect={onPickWorktree}
        />
      )}
    </div>
  );
}
