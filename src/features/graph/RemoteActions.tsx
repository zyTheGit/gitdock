import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { Icon, type IconName } from "../../assets/icons";
import { useI18n } from "../../i18n";
import { consumeEsc } from "../../shared/esc";
import type { RemoteActions as RemoteActionsState } from "../../app/useRemoteActions";
import {
  FETCH_MENU_ITEMS,
  PULL_MENU_ITEMS,
  type RemoteMenuAction,
  type RemoteMenuItem,
} from "./remoteActionsMenu";

type RemoteMenuName = "fetch" | "pull";

interface RemoteActionsProps {
  remote: RemoteActionsState;
  /** 确认框打开期间也关闭远程入口，避免两个远程流程重叠。 */
  disabled?: boolean;
  onFetchPrune: () => void;
}

interface RemoteActionMenuProps {
  icon: IconName;
  label: string;
  busyLabel: string;
  title: string;
  ariaLabel: string;
  menuLabel: string;
  items: readonly RemoteMenuItem[];
  disabled: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (action: RemoteMenuAction) => void;
}

function RemoteActionMenu({
  icon,
  label,
  busyLabel,
  title,
  ariaLabel,
  menuLabel,
  items,
  disabled,
  busy,
  open,
  onOpenChange,
  onSelect,
}: RemoteActionMenuProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = `graph-remote-${items[0].id}-menu`;
  const currentLabel = busy ? busyLabel : label;

  const close = useCallback(
    (returnFocus: boolean) => {
      onOpenChange(false);
      setActiveIndex(0);
      if (returnFocus) {
        triggerRef.current?.focus();
      }
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open || disabled) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>(`[data-remote-menu-index="${activeIndex}"]`)
      ?.focus();
  }, [activeIndex, disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    const onResize = () => close(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [close, open]);

  const choose = (index: number) => {
    const item = items[index];
    if (!item || disabled) {
      return;
    }
    // 先归还焦点再开始动作；动作开始后触发按钮会进入共享 disabled。
    close(true);
    onSelect(item.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      consumeEsc(event.nativeEvent);
      close(true);
      return;
    }
    if (event.key === "Tab" && open) {
      close(false);
      return;
    }
    if (!open) {
      if (!disabled && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setActiveIndex(event.key === "ArrowDown" ? 0 : items.length - 1);
        onOpenChange(true);
      }
      return;
    }
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (index + delta + items.length) % items.length);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : items.length - 1);
      return;
    }
    if (event.key === "Enter" && menuRef.current?.contains(event.target as Node)) {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) {
      close(false);
    }
  };

  return (
    <div className="remote-action-menu" ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="remote-action-trigger"
        disabled={disabled}
        aria-label={busy ? busyLabel : ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy}
        title={busy ? busyLabel : title}
        onClick={() => {
          if (disabled) {
            return;
          }
          if (open) {
            close(true);
          } else {
            setActiveIndex(0);
            onOpenChange(true);
          }
        }}
      >
        <Icon name={icon} />
        <span className="remote-action-label">{currentLabel}</span>
        <Icon name="chevronDown" className="remote-action-caret" />
      </button>
      {open && !disabled && (
        <div
          ref={menuRef}
          id={menuId}
          className={`remote-actions-menu remote-actions-menu-${items[0].action.kind}`}
          role="menu"
          aria-label={menuLabel}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-remote-menu-index={index}
              title={t(item.titleKey)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 图谱远程工具栏：Fetch / Pull 菜单 + 直接 Push，全部共享同一执行态。 */
export function RemoteActions({ remote, disabled = false, onFetchPrune }: RemoteActionsProps) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<RemoteMenuName | null>(null);
  const blocked = disabled || remote.disabled || remote.busy !== null;

  useEffect(() => {
    if (blocked) {
      setOpenMenu(null);
    }
  }, [blocked]);

  const setFetchOpen = useCallback((open: boolean) => {
    setOpenMenu((current) => (open ? "fetch" : current === "fetch" ? null : current));
  }, []);
  const setPullOpen = useCallback((open: boolean) => {
    setOpenMenu((current) => (open ? "pull" : current === "pull" ? null : current));
  }, []);
  const execute = useCallback(
    (action: RemoteMenuAction) => {
      if (blocked) {
        return;
      }
      setOpenMenu(null);
      if (action.kind === "fetch_prune") {
        onFetchPrune();
        return;
      }
      remote.run(action.kind, action.kind === "pull" ? action.mode : undefined);
    },
    [blocked, onFetchPrune, remote],
  );

  return (
    <div
      className="remote-actions"
      role="group"
      aria-label={t("graph.remoteActionsAria")}
      aria-busy={remote.busy !== null || disabled}
    >
      <RemoteActionMenu
        icon="cloudDownload"
        label={t("graph.fetch")}
        busyLabel={t("graph.fetching")}
        title={t("graph.fetchMenuTitle")}
        ariaLabel={t("graph.fetchMenuAria")}
        menuLabel={t("graph.fetchMenuAria")}
        items={FETCH_MENU_ITEMS}
        disabled={blocked}
        busy={remote.busy === "fetch"}
        open={openMenu === "fetch"}
        onOpenChange={setFetchOpen}
        onSelect={execute}
      />
      <RemoteActionMenu
        icon="download"
        label={t("graph.pull")}
        busyLabel={t("graph.pulling")}
        title={t("graph.pullMenuTitle")}
        ariaLabel={t("graph.pullMenuAria")}
        menuLabel={t("graph.pullMenuAria")}
        items={PULL_MENU_ITEMS}
        disabled={blocked}
        busy={remote.busy === "pull"}
        open={openMenu === "pull"}
        onOpenChange={setPullOpen}
        onSelect={execute}
      />
      <button
        type="button"
        disabled={blocked}
        aria-label={remote.busy === "push" ? t("graph.pushing") : t("graph.pushTitle")}
        aria-busy={remote.busy === "push"}
        title={remote.busy === "push" ? t("graph.pushing") : t("graph.pushTitle")}
        onClick={() => remote.run("push")}
      >
        <Icon name="upload" />
        <span className="remote-action-label">
          {remote.busy === "push" ? t("graph.pushing") : t("graph.push")}
        </span>
      </button>
    </div>
  );
}
