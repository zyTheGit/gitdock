import type { DiffMessages } from "../zh-CN/diff";

/** diff 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const diff = {
  statusAdded: "Added",
  statusDeleted: "Deleted",
  statusModified: "Modified",
  statusTypeChanged: "Type changed",
  statusRenamed: "Renamed",
  statusCopied: "Copied",
  loading: "Loading…",
  expandedViewLabel: "File diff expanded view",
  collapseFileList: "Collapse changed file list",
  expandFileList: "Expand changed file list",
  viewMode: "Diff view mode",
  splitView: "Split view",
  unifiedView: "Unified view",
  wrapTitle: "Wrap long lines to avoid horizontal scrolling",
  wrap: "Wrap long lines",
  restoreHint: "Restore (Esc)",
  expandHint: "Expand diff to the full window",
  restoreView: "Restore diff view",
  expandView: "Expand diff view",
  changedFileList: "Changed file list",
  changedFiles: "Changed files",
  fileContextMenuHint: "{{path}} (right-click to compare with an external tool)",
  previousFile: "Previous file",
  nextFile: "Next file",
  switchFile: "Switch compared file",
  filePickerLabel: "{{index}}/{{total}} · {{path}}",
  binaryFile: "Binary file; text diff not shown.",
  tooLarge: "File too large; only change statistics are shown.",
  truncated: "Diff is too long; truncated to the first lines.",
  encodingFallback: "File contains non-UTF-8 bytes; displayed with replacement characters.",
  gitlinkChanged: "Submodule pointer changed: ",
  gitlinkEmpty: "(empty)",
  gitlinkNoExpand: " (submodule internals not diffed)",
  noHighlight:
    "Syntax highlighting is off (language unsupported or too many changed lines); inline change markers are kept.",
  noTextDiff: "No text diff to show for this file.",
} satisfies DiffMessages;

export default diff;