import type { RefObject } from "react";
import { Icon } from "../assets/icons";
import { useI18n } from "../i18n";
import { primaryModifierLabel } from "../shared/platform";
import { RepositorySwitcher } from "../features/repository/RepositorySwitcher";
import { WorkspaceBadge } from "./WorkspaceBadge";
import type { RecentRepository, RepoId, RepoStateDto, RepoTabDto, WorkspaceStatusDto } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

function ActionIcon({ name }: { name: "search" | "compare" | "refresh" | "settings" | "gitBranch" }) {
  return <Icon name={name} className="topbar-action-icon" />;
}

interface TopBarProps {
  repo: RepoStateDto | null;
  workspace: WorkspaceStatusDto | null;
  tabs: RepoTabDto[];
  activeRepoId: RepoId | null;
  recent: RecentRepository[];
  busy: boolean;
  mode: ViewMode;
  compareReady: boolean;
  /** 可参与对比的引用数（本地分支 + 远程分支 + 标签）。 */
  refCount: number;
  /** ≤640px 时打开引用浮层；宽窗口时切换普通侧栏。 */
  narrow: boolean;
  refsOpen: boolean;
  sidebarVisible: boolean;
  onToggleRefs: () => void;
  refsButtonRef: RefObject<HTMLButtonElement>;
  refsPopoverId: string;
  onActivateRepo: (repoId: RepoId) => void;
  onOpenRepo: (path: string) => void;
  onForgetRepo: (path: string) => void;
  onPickRepo: () => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
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
  tabs,
  activeRepoId,
  recent,
  busy,
  mode,
  compareReady,
  refCount,
  narrow,
  refsOpen,
  sidebarVisible,
  onToggleRefs,
  refsButtonRef,
  refsPopoverId,
  onActivateRepo,
  onOpenRepo,
  onForgetRepo,
  onPickRepo,
  onRefresh,
  onOpenSettings,
  searchOpen,
  onToggleSearch,
  setMode,
  onOpenBranchCompare,
}: TopBarProps) {
  const { t } = useI18n();
  const refsExpanded = narrow ? refsOpen : sidebarVisible;
  const refsTitle = narrow
    ? t("shell.openRefsTitle")
    : sidebarVisible
      ? t("shell.hideSidebarTitle")
      : t("shell.showSidebarTitle");
  return (
    <header className="topbar">
      <RepositorySwitcher
        currentPath={repo?.path ?? null}
        tabs={tabs}
        activeRepoId={activeRepoId}
        recent={recent}
        busy={busy}
        onActivate={onActivateRepo}
        onOpen={onOpenRepo}
        onForget={onForgetRepo}
        onPick={onPickRepo}
      />
      {repo && workspace && (
        <WorkspaceBadge
          workspace={workspace}
          active={mode === "staging"}
          onToggle={() => setMode(mode === "staging" ? "graph" : "staging")}
        />
      )}
      <div className="topbar-actions">
        {repo && (
          <>
            <button
              type="button"
              ref={refsButtonRef}
              className={refsExpanded ? "active" : ""}
              onClick={onToggleRefs}
              title={refsTitle}
              aria-label={t("shell.refsLabel")}
              aria-expanded={refsExpanded}
              aria-controls={narrow ? refsPopoverId : "repository-sidebar"}
            >
              <ActionIcon name="gitBranch" /><span>{t("shell.refsLabel")}</span>
            </button>
            <button
              className={searchOpen ? "active" : ""}
              onClick={onToggleSearch}
              title={t("shell.searchButtonTitle")}
            >
              <ActionIcon name="search" /><span>{t("shell.search")}</span>
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
              disabled={!compareReady && refCount < 2}
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