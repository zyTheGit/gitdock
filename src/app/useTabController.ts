import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalSlot } from "./PanelArea";
import type { useBottomPanel } from "./useBottomPanel";
import type { RepoTabsHandle } from "./useRepoTabs";
import type { RepoTabViewState } from "./useRepoTabState";
import { errorText } from "../shared/error";
import type { RepoId, RepoStateDto } from "../shared/types";

interface TabControllerOptions {
  tabs: RepoTabsHandle;
  tabState: RepoTabViewState;
  panel: ReturnType<typeof useBottomPanel>;
  /** 丢弃该标签的对比槽位（useCompareSlots.forgetTab）。 */
  forgetCompareTab: (repoId: RepoId) => void;
  /** 切换/关闭标签前收起依附于旧仓库的浮层。 */
  resetOverlays: () => void;
  applyActiveState: (state: RepoStateDto | null) => Promise<void>;
  reloadSettings: () => Promise<void>;
  setError: (message: string | null) => void;
  setToast: (message: string | null) => void;
  /** 终端进程退出提示（已翻译）。 */
  terminalEndedMessage: string;
}

export interface TabController {
  /** 开过终端的标签常驻实例：非活动标签只隐藏，PTY 与 xterm 缓冲不丢（ADR-0032）。 */
  terminals: TerminalSlot[];
  activateTab: (repoId: RepoId) => Promise<void>;
  closeTab: (repoId: RepoId) => Promise<void>;
  handleTerminalRunning: (repoId: RepoId, running: boolean) => void;
  handleTerminalRepoChanged: (repoId: RepoId) => void;
}

/**
 * 标签切换/关闭与终端常驻（ADR-0032）：把「后端结果 → 视图态 → 会话状态」的落地顺序，
 * 以及每标签终端实例的保活与运行状态上报，从 App 中抽出，避免 App 继续膨胀。
 */
export function useTabController({
  tabs,
  tabState,
  panel,
  forgetCompareTab,
  resetOverlays,
  applyActiveState,
  reloadSettings,
  setError,
  setToast,
  terminalEndedMessage,
}: TabControllerOptions): TabController {
  const [terminalIds, setTerminalIds] = useState<RepoId[]>([]);
  const terminalRunningRef = useRef<Record<number, boolean>>({});
  const activeIdRef = useRef<RepoId | null>(null);
  activeIdRef.current = tabs.activeId;

  // 终端退出提示只属于活动标签：其他标签的终端变化不打扰当前视图。
  const handleTerminalRepoChanged = useCallback(
    (repoId: RepoId) => {
      if (repoId !== activeIdRef.current) {
        return;
      }
      panel.collapse();
      setToast(terminalEndedMessage);
    },
    [panel.collapse, setToast, terminalEndedMessage],
  );

  const handleTerminalRunning = useCallback(
    (repoId: RepoId, running: boolean) => {
      terminalRunningRef.current[repoId] = running;
      if (repoId === activeIdRef.current) {
        panel.setTerminalRunning(running);
      }
    },
    [panel.setTerminalRunning],
  );

  // 终端标签处于可见状态时，把活动标签的终端实例加入常驻集合，并同步记住的运行状态。
  // 只在终端真正展示时挂载：切走即隐藏，但不在每个访问过的标签上无谓拉起 PTY。
  const terminalVisible =
    panel.terminalMounted && panel.panelOpen && panel.activeTab === "terminal";
  useEffect(() => {
    const id = tabs.activeId;
    if (!terminalVisible || id === null) {
      return;
    }
    setTerminalIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    panel.setTerminalRunning(Boolean(terminalRunningRef.current[id]));
  }, [terminalVisible, panel.setTerminalRunning, tabs.activeId]);

  const terminals = useMemo(
    () =>
      tabs.tabs
        .filter((tab) => terminalIds.includes(tab.repo_id))
        .map((tab) => ({ repoId: tab.repo_id, repoPath: tab.path })),
    [tabs.tabs, terminalIds],
  );

  // 标签切换：后端结果决定活动仓库；视图态先恢复，再落快照，避免旧 scope 对旧仓库重拉。
  const activateTab = useCallback(
    async (repoId: RepoId) => {
      if (repoId === tabs.activeId || tabs.busy) {
        return;
      }
      try {
        const result = await tabs.activate(repoId);
        tabState.switchTo(repoId, false);
        resetOverlays();
        await applyActiveState(result.state);
        await reloadSettings();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [tabs.activeId, tabs.busy, tabs.activate, tabState.switchTo, resetOverlays, applyActiveState, reloadSettings, setError],
  );

  // 关闭标签：后端选择接替者；没有剩余标签时回到欢迎页（state 为 null）。
  const closeTab = useCallback(
    async (repoId: RepoId) => {
      if (tabs.busy) {
        return;
      }
      try {
        const result = await tabs.close(repoId);
        tabState.forget(repoId);
        forgetCompareTab(repoId);
        setTerminalIds((prev) => prev.filter((id) => id !== repoId));
        delete terminalRunningRef.current[repoId];
        tabState.switchTo(result.activeId, false);
        resetOverlays();
        await applyActiveState(result.state);
        await reloadSettings();
      } catch (err) {
        setError(errorText(err));
      }
    },
    [
      tabs.busy,
      tabs.close,
      tabState.forget,
      tabState.switchTo,
      forgetCompareTab,
      resetOverlays,
      applyActiveState,
      reloadSettings,
      setError,
    ],
  );

  return { terminals, activateTab, closeTab, handleTerminalRunning, handleTerminalRepoChanged };
}
