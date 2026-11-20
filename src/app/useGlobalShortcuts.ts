import { useCallback, useEffect } from "react";
import { useKeybindings } from "../shared/keybindings";
import type { useBottomPanel } from "./useBottomPanel";
import type { ViewMode } from "./useGlobalEsc";
import type { useFontScale } from "./useFontScale";

interface UseGlobalShortcutsParams {
  repoOpen: boolean;
  panel: ReturnType<typeof useBottomPanel>;
  zoom: ReturnType<typeof useFontScale>;
  /** 手动刷新：重读仓库快照并重载当前图谱页。 */
  refresh: () => Promise<void>;
  clearRemoteError: () => void;
  setMode: (mode: ViewMode) => void;
}

/** 有模态层（搜索框、设置、确认框等）时，视图切换快捷键让路，不改变被遮住的界面。 */
function modalOpen(): boolean {
  return document.querySelector(".modal-backdrop") !== null;
}

/** 输入控件内不响应无修饰键的快捷字符，避免打断输入。 */
function inEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return element?.closest("input, textarea, select, [contenteditable='true']") != null;
}

/**
 * 全局快捷键：终端开合、缩放（可改键），搜索、手动刷新、图谱/暂存区切换，
 * 以及非输入框聚焦时的 `/` 搜索入口。键位可在设置「快捷键」分区修改。
 *
 * 可改键部分经 useKeybindings 在捕获阶段派发（终端内的按键也由窗口层接管）；
 * `/` 走冒泡阶段，让输入控件先处理自己的按键。
 */
export function useGlobalShortcuts({
  repoOpen,
  panel,
  zoom,
  refresh,
  clearRemoteError,
  setMode,
}: UseGlobalShortcutsParams) {
  const openSearch = useCallback(() => {
    if (!repoOpen || modalOpen()) {
      return;
    }
    setMode("search");
  }, [repoOpen, setMode]);

  const refreshWorkspace = useCallback(() => {
    if (!repoOpen || modalOpen()) {
      return;
    }
    clearRemoteError();
    void refresh();
  }, [clearRemoteError, refresh, repoOpen]);

  useKeybindings({
    "terminal.toggle": repoOpen ? panel.toggleTerminal : undefined,
    "zoom.in": zoom.zoomIn,
    "zoom.out": zoom.zoomOut,
    "zoom.reset": zoom.resetZoom,
    "app.search": openSearch,
    "app.refresh": refreshWorkspace,
    "view.graph": () => {
      if (!modalOpen()) {
        setMode("graph");
      }
    },
    "view.staging": repoOpen
      ? () => {
          if (!modalOpen()) {
            setMode("staging");
          }
        }
      : undefined,
  });

  useEffect(() => {
    if (!repoOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (modalOpen() || inEditable(event.target)) {
        return;
      }
      event.preventDefault();
      setMode("search");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [repoOpen, setMode]);
}
