import { useI18n } from "../i18n";
import { workspaceLabel } from "../features/repository/workspace";
import type { WorkspaceStatusDto } from "../shared/types";

export function WorkspaceBadge({ workspace }: { workspace: WorkspaceStatusDto }) {
  const { t } = useI18n();
  return (
    <div
      className={`workspace-badge ${
        workspace.conflicted > 0 ? "conflict" : workspace.dirty ? "dirty" : "clean"
      }`}
      title={[
        t("shell.workspaceStaged", { n: workspace.staged }),
        t("shell.workspaceModified", { n: workspace.tracked }),
        t("shell.workspaceUntracked", { n: workspace.untracked }),
        t("shell.badgeConflicted", { n: workspace.conflicted }),
        ...(workspace.detached ? ["detached HEAD"] : []),
      ].join(" · ")}
    >
      {workspaceLabel(workspace)}
    </div>
  );
}
