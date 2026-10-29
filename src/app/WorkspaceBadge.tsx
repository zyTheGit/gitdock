import { workspaceLabel } from "../features/repository/workspace";
import type { WorkspaceStatusDto } from "../shared/types";

export function WorkspaceBadge({ workspace }: { workspace: WorkspaceStatusDto }) {
  return (
    <div
      className={`workspace-badge ${
        workspace.conflicted > 0 ? "conflict" : workspace.dirty ? "dirty" : "clean"
      }`}
      title={`已暂存 ${workspace.staged} · 已修改 ${workspace.tracked} · 未跟踪 ${workspace.untracked} · 冲突 ${workspace.conflicted}${
        workspace.detached ? " · detached HEAD" : ""
      }`}
    >
      {workspaceLabel(workspace)}
    </div>
  );
}
