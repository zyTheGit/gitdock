import type { TerminalMessages } from "../zh-CN/terminal";

/** terminal 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const terminal = {
  title: "Terminal",
  permissionNote: "Runs with current user privileges",
  resizeHint: "Drag to resize terminal height",
  launchLazygit: "Launch lazygit",
  launchLazygitTitle: "Launch lazygit in the current repository",
  launchShell: "Launch shell",
  endProcess: "End terminal process",
  endProcessTitle: "End the terminal process (interrupts the running command)",
  enterFullscreen: "Fullscreen terminal ({{modifier}}+Shift+Enter)",
  restoreFullscreen: "Restore terminal ({{modifier}}+Shift+Enter)",
  fullscreen: "Fullscreen",
  restore: "Restore",
  collapseLabel: "Collapse terminal",
  collapseTitle: "Collapse panel; the terminal process keeps running, press {{shortcut}} to restore",
  lazygitMissingTitle: "LazyGit not found; install it or set its path in settings",
  lazygitNoticePrefix: "LazyGit not found: run ",
  lazygitNoticeSuffix: " to install it, or set the executable path in settings; the shell is unaffected. ",
  lazygitInstallWindows: "winget install JesseDuffield.lazygit",
  lazygitInstallMac: "brew install jessevield/tap/lazygit",
  lazygitInstallLinux: "Use your distribution's package manager or download from GitHub Releases",
  openSettings: "Open settings",
  processExited: "[Process exited, code {{code}}]",
} satisfies TerminalMessages;

export default terminal;