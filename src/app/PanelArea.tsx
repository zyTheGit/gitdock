import { BottomPanel } from "../features/panel/BottomPanel";
import { CommandLogView } from "../features/gitlog/CommandLogView";
import { TerminalView } from "../features/terminal/TerminalView";
import type { ShellProfile } from "../features/terminal/ShellProfileSelect";
import type { useBottomPanel } from "./useBottomPanel";
import type { RepoId, SettingsDto } from "../shared/types";

/** 已挂载终端面板的标签：repoPath 在挂载时固定，切换标签不重建。 */
export interface TerminalSlot {
  repoId: RepoId;
  repoPath: string;
}

interface PanelAreaProps {
  /** 底部面板状态与动作（useBottomPanel 的完整返回值）。 */
  panel: ReturnType<typeof useBottomPanel>;
  /** 已打开过终端的标签（按 repo id）；每个标签的 TerminalView 常驻，非活动只隐藏。 */
  terminals: TerminalSlot[];
  /** 活动标签：只有它的终端可见并能上报运行状态。 */
  activeRepoId: RepoId | null;
  /** 无任何仓库时禁用终端标签；命令日志始终可用。 */
  terminalEnabled: boolean;
  /** 设置中的 LazyGit 路径；空串表示 PATH 探测。 */
  lazygitConfig: string;
  /** 当前持久化的 Shell 选择（Windows 终端工具栏下拉用）。 */
  shellProfile: ShellProfile;
  onShellProfileSaved: (settings: SettingsDto) => void;
  onOpenSettings: () => void;
  onTerminalRunningChange: (repoId: RepoId, running: boolean) => void;
  onTerminalRepoChanged: (repoId: RepoId) => void;
  terminalShortcut: string;
}

/**
 * 底部面板装配（ADR-0023 / ADR-0032）：按挂载标记渲染 BottomPanel，并装配终端与
 * 命令日志两个内容 View。每个开过终端的标签各有一个常驻 TerminalView，
 * 非活动标签以 hidden 隐藏——卸载会结束 PTY 并丢失 xterm 缓冲。
 * 纯装配组件，状态全部来自 useBottomPanel 与 App 传入的标签列表。
 */
export function PanelArea({
  panel,
  terminals,
  activeRepoId,
  terminalEnabled,
  lazygitConfig,
  shellProfile,
  onShellProfileSaved,
  onOpenSettings,
  onTerminalRunningChange,
  onTerminalRepoChanged,
  terminalShortcut,
}: PanelAreaProps) {
  if (!panel.terminalMounted && !panel.logMounted) {
    return null;
  }
  const terminalActive = panel.panelOpen && panel.activeTab === "terminal";
  return (
    <BottomPanel
      open={panel.panelOpen}
      activeTab={panel.activeTab}
      terminalEnabled={terminalEnabled}
      terminalShortcut={terminalShortcut}
      onCollapse={panel.collapse}
      onTabChange={panel.selectTab}
      onOpenTab={panel.openTab}
      terminalView={
        <>
          {terminals.map((slot) => {
            const visible = terminalActive && slot.repoId === activeRepoId;
            return (
              <div key={slot.repoId} className="terminal-slot" hidden={!visible}>
                <TerminalView
                  repoPath={slot.repoPath}
                  visible={visible}
                  lazygitConfig={lazygitConfig}
                  shellProfile={shellProfile}
                  onShellProfileSaved={onShellProfileSaved}
                  onOpenSettings={onOpenSettings}
                  onRunningChange={(running) => onTerminalRunningChange(slot.repoId, running)}
                  onRepoChanged={() => onTerminalRepoChanged(slot.repoId)}
                />
              </div>
            );
          })}
        </>
      }
      logView={
        panel.logMounted ? (
          <CommandLogView active={panel.panelOpen && panel.activeTab === "log"} />
        ) : null
      }
    />
  );
}
