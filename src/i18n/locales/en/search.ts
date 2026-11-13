import type { SearchMessages } from "../zh-CN/search";

/** search 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const search = {
  dialogTitle: "Search commits",
  closeSearch: "Close search",
  placeholder: "Search message / hash (at least 7 chars) / author / path",
  searchButton: "Search",
  searching: "Searching…",
  cancel: "Cancel",
  scopeHint: 'Scope: {{repo}} · refs in current view · file paths matched by "appears in changes"',
  scopeWithResults:
    'Scope: {{repo}} · refs in current view · file paths matched by "appears in changes" · {{n}} results returned',
  canceled: "Search canceled; results already returned are kept, no more will be appended.",
  pathScanHint: "Path matching scans at most the first {{n}} commits per page.",
  noResults: "No matching commits. Hash prefix must be at least 7 characters.",
  hintEnter: "Type a keyword and press Enter to search; ",
  hintPick: " pick a suggestion,",
  hintClose: " close. ",
  hintSource: "Suggestions come from the authors and messages of currently loaded commits.",
  locateInGraph: "{{oid}} · Locate in main graph",
  noSummary: "(no commit message)",
  fieldMessage: "Message",
  fieldHash: "Hash",
  fieldAuthor: "Author",
  fieldPath: "Path",
  loadingMore: "Loading…",
  loadMore: "Load more results",
  repoChanged: "Repository state has changed; search again.",
} satisfies SearchMessages;

export default search;