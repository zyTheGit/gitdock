import type { TerminalMessages } from "../zh-CN/terminal";

/** terminal 域英文资源；用 satisfies 保证与 zh-CN 的 key 结构同构。 */
const terminal = {
  tabLabel: "Terminal",
  title: "Terminal",
  permissionNote: "Runs with current user privileges",

  launchLazygit: "Launch lazygit",
  launchLazygitTitle: "Launch lazygit in the current repository",
  launchShell: "Launch shell",
  endProcess: "End terminal process",
  endProcessTitle: "End the terminal process (interrupts the running command)",
  enterFullscreen: "Fullscreen terminal ({{modifier}}+Shift+Enter)",
  restoreFullscreen: "Restore terminal ({{modifier}}+Shift+Enter)",

  lazygitMissingTitle: "LazyGit not found; install it or set its path in settings",
  lazygitNoticePrefix: "LazyGit not found: run ",
  lazygitNoticeSuffix: " to install it, or set the executable path in settings; the shell is unaffected. ",
  lazygitInstallWindows: "winget install JesseDuffield.lazygit",
  lazygitInstallMac: "brew install jessevield/tap/lazygit",
  lazygitInstallLinux: "Use your distribution's package manager or download from GitHub Releases",
  openSettings: "Open settings",
  processExited: "[Process exited, code {{code}}]",
  shellLabel: "Shell",
  shellDefault: "Default (PowerShell)",
  shellGitBash: "Git Bash",
  shellGitBashMissing: "Git Bash not detected: the Git Bash option is unavailable; make sure Git for Windows is installed.",
  shellSwitchHint: "Switching the shell will restart the current terminal session.",
  shellSwitchConfirm: "Restart",
  shellSwitchCancel: "Cancel",
  shellLazygitBlocked: "LazyGit is running; end the process before switching the shell.",
  shellSwitchFailed: "Shell switch did not take effect: {{error}}",
} satisfies TerminalMessages;

export default terminal;