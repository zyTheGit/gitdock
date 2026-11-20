import { useI18n } from "../i18n";
import { workspaceLabel } from "../features/repository/workspace";
import type { WorkspaceStatusDto } from "../shared/types";

interface WorkspaceBadgeProps {
  workspace: WorkspaceStatusDto;
  /** 当前是否已在暂存区视图：用于高亮与 aria-pressed。 */
  active: boolean;
  /** 点击切换进入/退出暂存区；bare 仓库无工作区，保持禁用。 */
  onToggle: () => void;
}

/**
 * 顶栏工作区徽标：语义化按钮，点击直达暂存区（T03）。
 * bare 仓库没有工作区可看，禁用并只保留统计提示。
 */
export function WorkspaceBadge({ workspace, active, onToggle }: WorkspaceBadgeProps) {
  const { t } = useI18n();
  const state = workspace.conflicted > 0 ? "conflict" : workspace.dirty ? "dirty" : "clean";
  const disabled = workspace.is_bare;
  const title = [
    t("shell.workspaceStaged", { n: workspace.staged }),
    t("shell.workspaceModified", { n: workspace.tracked }),
    t("shell.workspaceUntracked", { n: workspace.untracked }),
    t("shell.badgeConflicted", { n: workspace.conflicted }),
    ...(workspace.detached ? ["detached HEAD"] : []),
    ...(disabled ? [] : [t(active ? "shell.workspaceBadgeExitHint" : "shell.workspaceBadgeOpenHint")]),
  ].join(" · ");

  return (
    <button
      type="button"
      className={`workspace-badge ${state}${active ? " active" : ""}`}
      disabled={disabled}
      aria-pressed={disabled ? undefined : active}
      onClick={onToggle}
      title={title}
    >
      {workspaceLabel(workspace)}
    </button>
  );
}
