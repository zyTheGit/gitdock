import type { ReactNode } from "react";
import { RepositorySwitcher } from "../features/repository/RepositorySwitcher";
import { WorkspaceBadge } from "./WorkspaceBadge";
import type { RecentRepository, RepoStateDto, WorkspaceStatusDto } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

function ActionIcon({ name }: { name: "search" | "stage" | "compare" | "terminal" | "settings" | "refresh" }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.2 4.2" /></>,
    stage: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 16v4h16v-4" /></>,
    compare: <><path d="M7 4v16m10-16v16" /><path d="M4 8h6m4 8h6" /><circle cx="7" cy="8" r="2" /><circle cx="17" cy="16" r="2" /></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
    settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="M19 12h2m-18 0h2m7-7v2m0 10v2m4.95-12.95-1.4 1.4m-7.1 7.1-1.4 1.4m0-11.3 1.4 1.4m7.1 7.1 1.4 1.4" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2" /></>,
  };
  return <svg className="topbar-action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

interface TopBarProps {
  repo: RepoStateDto | null;
  workspace: WorkspaceStatusDto | null;
  recent: RecentRepository[];
  busy: boolean;
  mode: ViewMode;
  compareReady: boolean;
  localBranchCount: number;
  terminalOpen: boolean;
  terminalRunning: boolean;
  terminalShortcut: string;
  onOpenRepo: (path: string) => void;
  onForgetRepo: (path: string) => void;
  onPickRepo: () => void;
  onRefresh: () => void;
  closeSearch: () => void;
  setMode: (mode: ViewMode) => void;
  onOpenBranchCompare: () => void;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
}

/** 顶栏：仓库切换、工作区徽标与全局动作按钮。纯展示，动作经回调上抛。 */
export function TopBar({
  repo,
  workspace,
  recent,
  busy,
  mode,
  compareReady,
  localBranchCount,
  terminalOpen,
  terminalRunning,
  terminalShortcut,
  onOpenRepo,
  onForgetRepo,
  onPickRepo,
  onRefresh,
  closeSearch,
  setMode,
  onOpenBranchCompare,
  onToggleTerminal,
  onOpenSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <RepositorySwitcher
        currentPath={repo?.path ?? null}
        recent={recent}
        busy={busy}
        onOpen={onOpenRepo}
        onForget={onForgetRepo}
        onPick={onPickRepo}
      />
      {repo && workspace && <WorkspaceBadge workspace={workspace} />}
      <div className="topbar-actions">
        {repo && (
          <>
            <button
              className={mode === "search" ? "active" : ""}
              onClick={() => (mode === "search" ? closeSearch() : setMode("search"))}
              title="按说明、作者、路径或 hash 搜索提交；Esc 关闭"
            >
              <ActionIcon name="search" /><span>搜索</span>
            </button>
            <button
              className={mode === "staging" ? "active" : ""}
              onClick={() => setMode(mode === "staging" ? "graph" : "staging")}
              title="查看工作区改动，分别暂存或取消暂存文件；Esc 退出"
            >
              <ActionIcon name="stage" /><span>暂存区</span>
            </button>
            <button
              className={mode === "compare" ? "active" : ""}
              onClick={() => {
                if (compareReady) {
                  setMode("compare");
                } else {
                  onOpenBranchCompare();
                }
              }}
              disabled={!compareReady && localBranchCount < 2}
              title={
                compareReady
                  ? "查看对比结果"
                  : "选择两个分支对比，或用 Ctrl+点击提交选择 Base / Compare"
              }
            >
              <ActionIcon name="compare" /><span>对比</span>
            </button>
            <button
              className={terminalOpen ? "active" : ""}
              aria-pressed={terminalOpen}
              title={
                terminalRunning
                  ? `终端进程运行中；收起不会结束进程（${terminalShortcut}）`
                  : `打开终端（${terminalShortcut}）`
              }
              onClick={onToggleTerminal}
            >
              <ActionIcon name="terminal" /><span>终端{terminalRunning ? " ·" : ""}</span>
            </button>
          </>
        )}
        <button onClick={onOpenSettings}><ActionIcon name="settings" /><span>设置</span></button>
        <button onClick={onRefresh} disabled={busy || !repo}>
          <ActionIcon name="refresh" /><span>{busy ? "刷新中…" : "刷新"}</span>
        </button>
      </div>
    </header>
  );
}