import type { RepoStateDto } from "../shared/types";

/** HEAD 展示名：本地分支名、detached HEAD 或 unborn 分支文案。 */
export function formatHeadLabel(
  repo: RepoStateDto | null,
  branchFallback: string,
  unbornLabel: string,
): string {
  if (!repo) {
    return "";
  }
  if (repo.head.kind === "branch") {
    return repo.head.branch ?? branchFallback;
  }
  return repo.head.kind === "detached" ? "detached HEAD" : unbornLabel;
}