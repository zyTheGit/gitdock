import { Icon } from "../assets/icons";
import { useI18n } from "../i18n";
import { primaryModifierLabel } from "../shared/platform";
import { RepositorySwitcher } from "../features/repository/RepositorySwitcher";
import { WorkspaceBadge } from "./WorkspaceBadge";
import type { RecentRepository, RepoStateDto, WorkspaceStatusDto } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

function ActionIcon({ name }: { name: "search" | "stage" | "compare" | "terminal" | "settings" | "refresh" }) {
  return <Icon name={name} className="topbar-action-icon" />;
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
  const { t } = useI18n();
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
              title={t("shell.searchButtonTitle")}
            >
              <ActionIcon name="search" /><span>{t("shell.search")}</span>
            </button>
            <button
              className={mode === "staging" ? "active" : ""}
              onClick={() => setMode(mode === "staging" ? "graph" : "staging")}
              title={t("shell.stagingButtonTitle")}
            >
              <ActionIcon name="stage" /><span>{t("shell.staging")}</span>
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
                    ? t("shell.compareReadyTitle")
                    : t("shell.compareButtonTitle", { modifier: primaryModifierLabel() })
                }
            >
              <ActionIcon name="compare" /><span>{t("shell.compare")}</span>
            </button>
            <button
              className={terminalOpen ? "active" : ""}
              aria-pressed={terminalOpen}
              title={
                terminalRunning
                  ? t("shell.terminalRunningTitle", { shortcut: terminalShortcut })
                  : t("shell.openTerminalTitle", { shortcut: terminalShortcut })
              }
              onClick={onToggleTerminal}
            >
              <ActionIcon name="terminal" /><span>{t("shell.terminal")}{terminalRunning ? " ·" : ""}</span>
            </button>
          </>
        )}
        <button onClick={onOpenSettings}><ActionIcon name="settings" /><span>{t("shell.settings")}</span></button>
        <button onClick={onRefresh} disabled={busy || !repo}>
          <ActionIcon name="refresh" /><span>{busy ? t("shell.refreshing") : t("shell.refresh")}</span>
        </button>
      </div>
    </header>
  );
}