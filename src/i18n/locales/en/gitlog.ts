import type { GitlogMessages } from "../zh-CN/gitlog";

/** gitlog 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const gitlog = {
  tabLabel: "Command Log",

  dialogSubtitle: "Git commands executed by GitDock during this run; cleared on restart.",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  refreshed: "Refreshed",
  searchPlaceholder: "Search command, directory, or stderr…",
  searchAria: "Search Git command log",
  noMatches: "No matching commands",
  stats: "{{total}} total · {{failed}} failed",
  statsFiltered: "Showing {{visible}}",
  clearSearch: "Clear search",
  copyPath: "Copy path",
  clear: "Clear",
  confirmClear: "Confirm clear",
  clearHint: "Clears only this run's in-memory log; the on-disk app log is unchanged",
  copyCommand: "Copy",
  copied: "Copied",
  copyCommandAria: "Copy command: {{command}}",
  copyFailed: "Copy failed; select the command manually to copy",

  empty: "No git commands executed yet",
  filterFailed: "Failures only",
  exitCodeLabel: "Exit code",
  cwdLabel: "Working directory",
  startedAtLabel: "Started at",
  stderrLabel: "stderr",
  successBadge: "Success",
  failedBadge: "Failed",
  launchFailed: "Failed to start",
  noStderr: "No error output",
  openButtonTitle: "View Git command log",
} satisfies GitlogMessages;

export default gitlog;