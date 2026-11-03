import type { RepositoryMessages } from "../zh-CN/repository";

/** repository 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const repository = {
  groupCurrent: "Current window",
  groupRecent: "Recent repositories",
  switchRepoTitle: "Switch or open repository",
  switchRepoMenu: "Switch repository",
  searchPlaceholder: "Search repositories by name or path…",
  noMatches: "No matching repositories",
  recentCleared: "Recent repositories cleared; add one back via \"Open local repository…\" below",
  neverOpened: "No repository opened yet; start with \"Open local repository…\" below",
  removeRecentTitle: "Remove from recent (does not delete the local repository)",
  removeRecentAria: "Remove {{name}} from recent repositories",
  openLocalRepo: "Open local repository…",
  menuHint: "↑↓ Select · Enter Open · Esc Close",
  removedFromRecent: "Removed from recent repositories",
  pickDialogTitle: "Choose a Git repository",
  watchError: "Failed to watch repository changes: {{error}}",
  branchMenuEditDescription: "Edit description",
  branchMenuCompareWithHead: "Compare with HEAD",
  branchMenuSetBase: "Set as compare Base",
  branchMenuSetCompare: "Set as compare Compare",
} satisfies RepositoryMessages;

export default repository;