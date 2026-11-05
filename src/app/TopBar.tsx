import { Icon } from "../assets/icons";
import { useI18n } from "../i18n";
import { primaryModifierLabel } from "../shared/platform";
import { RepositorySwitcher } from "../features/repository/RepositorySwitcher";
import { WorkspaceBadge } from "./WorkspaceBadge";
import type { RecentRepository, RepoStateDto, WorkspaceStatusDto } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

function ActionIcon({ name }: { name: "search" | "stage" | "compare" | "refresh" | "settings" }) {
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
  onOpenRepo: (path: string) => void;
  onForgetRepo: (path: string) => void;
  onPickRepo: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  closeSearch: () => void;
  setMode: (mode: ViewMode) => void;
  onOpenBranchCompare: () => void;
}

/**
 * 顶栏：仓库切换、工作区徽标与全局动作按钮。纯展示，动作经回调上抛。
 * 设置入口在顶栏（ADR-0012 修订：Windows/Linux 无窗口菜单）；
 * 终端入口由底部面板、状态栏与快捷键承载，不占顶栏。
 */
export function TopBar({
  repo,
  workspace,
  recent,
  busy,
  mode,
  compareReady,
  localBranchCount,
  onOpenRepo,
  onForgetRepo,
  onPickRepo,
  onRefresh,
  onOpenSettings,
  closeSearch,
  setMode,
  onOpenBranchCompare,
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
          </>
        )}

        <button onClick={onRefresh} disabled={busy || !repo}>
          <ActionIcon name="refresh" /><span>{busy ? t("shell.refreshing") : t("shell.refresh")}</span>
        </button>
        <button onClick={onOpenSettings} title={t("shell.settingsButtonTitle")}>
          <ActionIcon name="settings" /><span>{t("shell.settings")}</span>
        </button>
      </div>
    </header>
  );
}