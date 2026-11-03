import type { GitlogMessages } from "../zh-CN/gitlog";

/** gitlog 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const gitlog = {
  dialogTitle: "Git Command Log",
  dialogSubtitle: "Git commands executed by GitDock during this run; cleared on restart.",
  refresh: "Refresh",
  closeAria: "Close command log",
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