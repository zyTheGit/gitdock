import { useCallback, useState } from "react";
import type { BottomPanelTab } from "../features/panel/BottomPanel";

const ACTIVE_TAB_KEY = "gitdock.bottomPanel.activeTab";

/** 上次使用的标签跨会话记忆；未知值兜底为终端标签。 */
function readActiveTab(): BottomPanelTab {
  return localStorage.getItem(ACTIVE_TAB_KEY) === "log" ? "log" : "terminal";
}

/**
 * 底部面板状态（ADR-0023）：面板开合、活动标签与两个内容 View 的挂载标记。
 * 面板开合不持久化（与旧终端面板一致）；活动标签持久化到 localStorage。
 * 首次打开某标签才挂载对应 View，此后收起只隐藏、不再卸载（保活 PTY 与日志筛选状态）。
 */
export function useBottomPanel() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<BottomPanelTab>(readActiveTab);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [logMounted, setLogMounted] = useState(false);
  const [terminalRunning, setTerminalRunning] = useState(false);

  const selectTab = useCallback((tab: BottomPanelTab) => {
    if (tab === "terminal") {
      setTerminalMounted(true);
    } else {
      setLogMounted(true);
    }
    setActiveTab(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
  }, []);

  /** 打开面板并激活终端标签（暂存区入口等「确保打开」语义）。 */
  const openTerminal = useCallback(() => {
    selectTab("terminal");
    setPanelOpen(true);
  }, [selectTab]);

  /** 终端标签已激活时收起面板，否则打开面板并切到终端标签。 */
  const toggleTerminal = useCallback(() => {
    if (panelOpen && activeTab === "terminal") {
      setPanelOpen(false);
      return;
    }
    openTerminal();
  }, [panelOpen, activeTab, openTerminal]);

  /** 命令日志标签已激活时收起面板，否则打开面板并切到日志标签。 */
  const toggleCommandLog = useCallback(() => {
    if (panelOpen && activeTab === "log") {
      setPanelOpen(false);
      return;
    }
    selectTab("log");
    setPanelOpen(true);
  }, [panelOpen, activeTab, selectTab]);

  const collapse = useCallback(() => setPanelOpen(false), []);

  return {
    panelOpen,
    activeTab,
    terminalMounted,
    logMounted,
    terminalRunning,
    setTerminalRunning,
    selectTab,
    openTerminal,
    toggleTerminal,
    toggleCommandLog,
    collapse,
  };
}