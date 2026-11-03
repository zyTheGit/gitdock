import type { DetailMessages } from "../zh-CN/detail";

/** detail 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const detail = {
  commitDetails: "Commit details",
  closeAria: "Close details",
  baselineRoot: "Root commit: compared against the empty tree",
  baselineFirstParent: "Compared against the first parent",
  baselineMerge:
    "Merge commit: compared against the first parent; differences introduced by other merged branches are not expanded",
  loading: "Loading commit details…",
  commitMessage: "Commit message",
  parents: "Parents",
  rootCommit: "(root commit)",
  containingBranches: "Contained in",
  noContainingBranches: "(no local branch contains this commit)",
  branchJumpTitle: "Switch to graph view of {{branch}}",
  changedFiles: "Changed files ({{n}})",
  noFileChanges: "This commit has no file changes.",
  fileRowTitle: "{{path}} (right-click to compare with an external tool)",
  fileDiffLoading: "Loading file diff…",
  selectFileHint: "Select a file on the left to view its diff.",
  noExternalTool: "No external tool configured",
  openWithTool: "Open with {{name}}",
} satisfies DetailMessages;

export default detail;