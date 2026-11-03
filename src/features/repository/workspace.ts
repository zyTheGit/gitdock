import { i18next } from "../../i18n";
import type { WorkspaceStatusDto } from "../../shared/types";

/** 顶栏工作区徽标文案：冲突优先，其次统计暂存/修改/未跟踪。 */
export function workspaceLabel(status: WorkspaceStatusDto): string {
  if (status.is_bare) {
    return i18next.t("shell.workspaceBare");
  }
  if (status.conflicted > 0) {
    return i18next.t("shell.workspaceConflicted", { n: status.conflicted });
  }
  if (!status.dirty) {
    return i18next.t("shell.workspaceClean");
  }
  const parts: string[] = [];
  if (status.staged > 0) parts.push(i18next.t("shell.workspaceStaged", { n: status.staged }));
  if (status.tracked > 0) parts.push(i18next.t("shell.workspaceModified", { n: status.tracked }));
  if (status.untracked > 0) parts.push(i18next.t("shell.workspaceUntracked", { n: status.untracked }));
  return i18next.t("shell.workspaceDirty", { parts: parts.join(" / ") });
}
