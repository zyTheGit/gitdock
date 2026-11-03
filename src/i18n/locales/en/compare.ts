import type { CompareMessages } from "../zh-CN/compare";

/** compare 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const compare = {
  // Selection bar
  slotUnselected: "Not selected",
  slotBase: "Base",
  slotCompare: "Compare",
  clearSlot: "Clear {{title}}",
  barLabel: "Compare selection",
  swapSides: "Swap Base and Compare",
  hintActive: "Changes of Compare against the common ancestor of Base · {{modifier}}+click to replace",
  hintIdle: '{{modifier}}+click a commit to fill Compare, or pick branches with "Compare branches…"',
  replaceWhichSide: "Replace which side?",
  newSelection: "New selection {{label}} ({{oid}})",
  replaceBase: "Replace Base",
  replaceCompare: "Replace Compare",
  cancel: "Cancel",

  // Branch compare dialog
  dialogTitle: "Compare branches",
  closeDialog: "Close branch compare",
  fieldBase: "Base (reference)",
  fieldCompare: "Compare (target)",
  modeHint:
    "Compares with three-point diff by default (common ancestor of Base and Compare → Compare); you can switch to a two-point snapshot in the compare view.",
  sameBranchError: "Base and Compare cannot be the same branch.",
  sameCommitHint: "Both branches currently point to the same commit; the comparison will be empty.",
  currentBranchOption: "{{branch}} (current)",
  startCompare: "Start compare",

  // Result view
  noExternalTool: "No external tool configured",
  openWithTool: "Open with {{name}}",
  openCurrentFile: "Open current file with {{name}}",
  externalToolFallback: "external tool",
  computing: "Computing three-point comparison…",
  noCommonAncestor:
    "The two refs have no common ancestor (shallow / orphan repository); the comparison has fallen back to a two-point snapshot.",
  sameCommitTip:
    "Base and Compare point to the same commit ({{oid}}); there is no difference to show.",
  emptyThreeDot:
    "Three-point diff is empty: Compare introduces no file changes against the common ancestor (for example, Compare is an ancestor of Base, or both working trees have identical content).",
  switchToTwoDot: "Switch to a two-point snapshot to see the full difference between the two ends",
  pathFilter: "Path filter",
  pathFilterPlaceholder: "e.g. src/ or README.md",
  clearFilter: "Clear",
  changedFilesCount: "Changed files: {{n}}",
  selectTool: "Select external compare tool",

  // Result header
  titleThreeDot: "Changes of Compare against the common ancestor of Base",
  titleTwoDot: "Full snapshot difference between Compare and Base",
  modeGroup: "Compare mode",
  modeThreeDot: "Three-point diff",
  modeTwoDot: "Two-point snapshot",
  modeTwoDotFallback: "Two-point snapshot (fallback)",
  modeThreeDotHint: "git diff base...compare: shows only the changes of Compare against the common ancestor",
  modeTwoDotHint: "git diff base compare: shows the full snapshot difference between the two commits",
  sideCounts: "Base only on left {{baseOnly}} · Compare only on right {{compareOnly}}",
  viewGraph: "View graph",

  // Commit list
  resizeHandle: "Resize commit list",
  resizeHint: "Drag to resize the commit list; double-click to reset",
  commitsIntroduced: "Commits introduced by Compare ({{n}})",
  commitsIntroducedTruncated: "Commits introduced by Compare ({{n}}+)",
  noNewCommits: "Compare has no new commits relative to the common ancestor.",

  // File list and diff pane
  changedFiles: "Changed files ({{n}})",
  noFileChanges: "No file changes in this range.",
  loadingDiff: "Loading file diff…",
  selectFileHint: "Select a file on the left to view its diff.",

  // Loading errors
  repoChanged: "The repository state has changed; refresh and retry the comparison",
  refUnresolved: "The ref can no longer be resolved; re-select Base / Compare",
} satisfies CompareMessages;

export default compare;