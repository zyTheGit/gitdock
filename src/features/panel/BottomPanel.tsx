import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { isEscConsumed } from "../../shared/esc";
import { primaryModifierLabel } from "../../shared/platform";
import { useI18n } from "../../i18n";
import { Icon } from "../../assets/icons";
import "../../styles/panel.css";

/** 底部面板的固定标签：终端与命令日志（ADR-0023）。 */
export type BottomPanelTab = "terminal" | "log";

const HEIGHT_KEY = "gitdock.terminal.height";

const MIN_HEIGHT = 140;

function readHeight(): number {
  const stored = Number(localStorage.getItem(HEIGHT_KEY));
  return Number.isFinite(stored) && stored >= MIN_HEIGHT ? stored : 280;
}

interface BottomPanelProps {
  /** 面板开合；关闭只隐藏视图，终端进程与日志状态保留。 */
  open: boolean;
  activeTab: BottomPanelTab;
  /** 无仓库时终端标签禁用；命令日志是应用级数据，始终可用。 */
  terminalEnabled: boolean;
  /** 终端开合的当前键位，只用于提示文案。 */
  terminalShortcut: string;
  onCollapse: () => void;
  onTabChange: (tab: BottomPanelTab) => void;
  /** 面板未打开时经标签快捷键直达：打开面板并激活指定标签。 */
  onOpenTab: (tab: BottomPanelTab) => void;
  /** 终端内容视图；挂载后由面板以 hidden 切换保活（卸载会结束 PTY）。 */
  terminalView: ReactNode;
  /** 命令日志内容视图。 */
  logView: ReactNode;
}

/**
 * 底部多标签面板（ADR-0023）：标签栏、高度拖拽与全屏等通用外框；
 * 终端与命令日志是两个内容 View，由 App 装配后经 slot 传入。
 * 首次启动终端后终端 View 必须保持挂载，切标签只切 hidden，避免杀掉 PTY。
 */
export function BottomPanel({
  open,
  activeTab,
  terminalEnabled,
  terminalShortcut,
  onCollapse,
  onTabChange,
  onOpenTab,
  terminalView,
  logView,
}: BottomPanelProps) {
  const { t } = useI18n();
  const [height, setHeight] = useState(readHeight);
  const [fullscreen, setFullscreen] = useState(false);
  const tabRefs = useRef<Record<BottomPanelTab, HTMLButtonElement | null>>({
    terminal: null,
    log: null,
  });

  const tabs: { key: BottomPanelTab; label: string; disabled: boolean }[] = [
    { key: "terminal", label: t("terminal.tabLabel"), disabled: !terminalEnabled },
    { key: "log", label: t("gitlog.tabLabel"), disabled: false },
  ];

  // 高度落盘与面板宽度同一策略：拖动中只进内存，抬手/取消时写一次，卸载兜底。
  const heightRef = useRef(height);
  const heightDirtyRef = useRef(false);

  const persistHeight = useCallback(() => {
    if (!heightDirtyRef.current) {
      return;
    }
    heightDirtyRef.current = false;
    localStorage.setItem(HEIGHT_KEY, String(heightRef.current));
  }, []);

  useEffect(() => persistHeight, [persistHeight]);

  // 面板关闭或切到命令日志标签时退出全屏：全屏是终端标签专属姿态。
  useEffect(() => {
    if (!open || activeTab !== "terminal") {
      setFullscreen(false);
    }
  }, [open, activeTab]);

  // 全屏还原（Esc）与终端全屏切换（Ctrl/Cmd+Shift+Enter）沿用原终端面板行为，仅面板打开时生效；
  // 标签切换 Ctrl/Cmd+PageUp/PageDown 在面板未打开时也生效（直接打开面板并切标签），
  // 弹窗打开时不触发。onOpenTab 与 onTabChange 区分：前者确保面板展开。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (open) {
        // 放大 diff 已消费的 Esc 不再还原面板全屏，一次按键只退出一层。
        if (event.key === "Escape" && fullscreen && !isEscConsumed(event)) {
          setFullscreen(false);
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "enter") {
          if (activeTab === "terminal") {
            event.preventDefault();
            setFullscreen((current) => !current);
          }
        }
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "PageUp" || event.key === "PageDown")) {
        if ((event.target as HTMLElement | null)?.closest(".modal-backdrop") != null) {
          return;
        }
        event.preventDefault();
        const tab = event.key === "PageUp" ? "terminal" : "log";
        if (open) {
          onTabChange(tab);
        } else {
          onOpenTab(tab);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, fullscreen, activeTab, onTabChange, onOpenTab]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fullscreen) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    // 拖动中只 setState 保持跟手，最新高度记进 ref，抬手/取消时统一落盘。
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        Math.max(startHeight + (startY - move.clientY), MIN_HEIGHT),
        Math.max(window.innerHeight - 240, MIN_HEIGHT),
      );
      heightRef.current = next;
      heightDirtyRef.current = true;
      setHeight(next);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      persistHeight();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  // 标签键盘导航：roving tabindex + 方向键循环（跳过禁用项）与 Home/End。
  const onTabsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const focusable = tabs.filter((tab) => !tab.disabled);
    const index = focusable.findIndex((tab) => tab.key === activeTab);
    if (index < 0) return;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % focusable.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + focusable.length) % focusable.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = focusable.length - 1;
        break;
      default:
        return;
    }
    const target = focusable[next === null ? 0 : next];
    event.preventDefault();
    onTabChange(target.key);
    tabRefs.current[target.key]?.focus();
  };

  const modifier = primaryModifierLabel();
  const fullscreenTitle = fullscreen
    ? t("terminal.restoreFullscreen", { modifier })
    : t("terminal.enterFullscreen", { modifier });

  return (
    <section
      className={fullscreen ? "bottom-panel fullscreen" : "bottom-panel"}
      style={fullscreen ? undefined : { height }}
      hidden={!open}
    >
      <div
        className="bottom-panel-resizer"
        role="separator"
        aria-orientation="horizontal"
        title={t("shell.panelResizeHint")}
        onPointerDown={startResize}
      />
      <header className="bottom-panel-header">
        <div className="bottom-panel-tabs" role="tablist" onKeyDown={onTabsKeyDown}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              ref={(node) => {
                tabRefs.current[tab.key] = node;
              }}
              type="button"
              role="tab"
              id={`bottom-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`bottom-panel-pane-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              className={activeTab === tab.key ? "bottom-panel-tab active" : "bottom-panel-tab"}
              disabled={tab.disabled}
              title={tab.disabled ? t("shell.terminalTabDisabledTitle") : undefined}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="bottom-panel-actions">
          <button
            className="terminal-fullscreen-button"
            onClick={() => setFullscreen((current) => !current)}
            disabled={!terminalEnabled || activeTab !== "terminal"}
            title={fullscreenTitle}
          >
            <Icon name={fullscreen ? "fullscreenRestore" : "fullscreen"} />
          </button>
          <button
            className="terminal-icon-button"
            onClick={onCollapse}
            aria-label={t("shell.collapsePanel")}
            title={t("shell.collapsePanelTitle", { shortcut: terminalShortcut })}
          >
            <Icon name="collapse" />
          </button>
        </div>
      </header>
      <div
        role="tabpanel"
        id="bottom-panel-pane-terminal"
        className="bottom-panel-pane"
        hidden={activeTab !== "terminal"}
      >
        {terminalView}
      </div>
      <div
        role="tabpanel"
        id="bottom-panel-pane-log"
        className="bottom-panel-pane"
        hidden={activeTab !== "log"}
      >
        {logView}
      </div>
    </section>
  );
}