import type { WorkspaceStatusDto } from "../../shared/types";

/** 顶栏工作区徽标文案：冲突优先，其次统计暂存/修改/未跟踪。 */
export function workspaceLabel(status: WorkspaceStatusDto): string {
  if (status.is_bare) {
    return "bare 仓库";
  }
  if (status.conflicted > 0) {
    return `工作区冲突 · ${status.conflicted} 个文件`;
  }
  if (!status.dirty) {
    return "工作区干净";
  }
  const parts: string[] = [];
  if (status.staged > 0) parts.push(`已暂存 ${status.staged}`);
  if (status.tracked > 0) parts.push(`已修改 ${status.tracked}`);
  if (status.untracked > 0) parts.push(`未跟踪 ${status.untracked}`);
  return `工作区脏 · ${parts.join(" / ")}`;
}
