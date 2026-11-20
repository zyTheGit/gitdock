import type { HistoryMessages } from "../zh-CN/history";

/** history 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const history = {
  title: "File history",
  closeAria: "Close file history",
  tabHistory: "History",
  tabBlame: "Blame",
  viewFileHistory: "View file history",
  viewFileBlame: "View blame",
  noHeadCommit: "No commits yet; history is unavailable",
  loadingHistory: "Loading file history…",
  loadingBlame: "Computing blame…",
  loadingDiff: "Loading this change…",
  emptyHistory: "No commit touches this path.",
  loadMore: "Load more",
  loadingMore: "Loading more…",
  timelineLabel: "File commit timeline",
  selectEntryHint: "Select a commit on the left to see how it changed this file.",
  locateCommit: "Locate this commit in the graph",
  compareAdjacent: "Compare adjacent versions",
  compareSingle: "Show single change",
  adjacentPair: "Adjacent versions {{from}} → {{to}}",
  blameBinary: "Binary files cannot be attributed line by line.",
  blameTooLarge: "File is too large; line attribution was skipped.",
  blameEmpty: "There are no lines to attribute.",
  blameEncoding: "File is not UTF-8; content is shown with lossy decoding.",
  limitations:
    "This version follows only the current path (no rename tracking); cross-merge attribution uses the first-parent chain.",
  stagingNote:
    "The staging entry shows content from HEAD and does not include uncommitted changes.",
  blameJumpTitle: "Locate commit {{oid}} in the graph",
} satisfies HistoryMessages;

export default history;
