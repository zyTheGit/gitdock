import { BottomPanel } from "../features/panel/BottomPanel";
import { CommandLogView } from "../features/gitlog/CommandLogView";
import { TerminalView } from "../features/terminal/TerminalView";
import type { ShellProfile } from "../features/terminal/ShellProfileSelect";
import type { useBottomPanel } from "./useBottomPanel";
import type { RepoStateDto, SettingsDto } from "../shared/types";

interface PanelAreaProps {
  /** 底部面板状态与动作（useBottomPanel 的完整返回值）。 */
  panel: ReturnType<typeof useBottomPanel>;
  repo: RepoStateDto | null;
  /** 设置中的 LazyGit 路径；空串表示 PATH 探测。 */
  lazygitConfig: string;
  /** 当前持久化的 Shell 选择（Windows 终端工具栏下拉用）。 */
  shellProfile: ShellProfile;
  onShellProfileSaved: (settings: SettingsDto) => void;
  onOpenSettings: () => void;
  onRepoChanged: () => void;
  terminalShortcut: string;
}

/**
 * 底部面板装配（ADR-0023）：按挂载标记渲染 BottomPanel，并装配终端与命令日志
 * 两个内容 View。终端 View 挂载后由面板以 hidden 切换保活（卸载会结束 PTY）；
 * 日志 View 激活时重拉快照。纯装配组件，状态全部来自 useBottomPanel。
 */
export function PanelArea({
  panel,
  repo,
  lazygitConfig,
  shellProfile,
  onShellProfileSaved,
  onOpenSettings,
  onRepoChanged,
  terminalShortcut,
}: PanelAreaProps) {
  if (!panel.terminalMounted && !panel.logMounted) {
    return null;
  }
  return (
    <BottomPanel
      open={panel.panelOpen}
      activeTab={panel.activeTab}
      terminalEnabled={Boolean(repo)}
      terminalShortcut={terminalShortcut}
      onCollapse={panel.collapse}
      onTabChange={panel.selectTab}
      onOpenTab={panel.openTab}
      terminalView={
        repo && panel.terminalMounted ? (
          <TerminalView
            repoPath={repo.path}
            visible={panel.panelOpen && panel.activeTab === "terminal"}
            lazygitConfig={lazygitConfig}
            shellProfile={shellProfile}
            onShellProfileSaved={onShellProfileSaved}
            onOpenSettings={onOpenSettings}
            onRunningChange={panel.setTerminalRunning}
            onRepoChanged={onRepoChanged}
          />
        ) : null
      }
      logView={
        panel.logMounted ? (
          <CommandLogView active={panel.panelOpen && panel.activeTab === "log"} />
        ) : null
      }
    />
  );
}