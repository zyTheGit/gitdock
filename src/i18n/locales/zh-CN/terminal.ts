import type { MessageShape } from "../messages";

/** terminal 域：终端面板与 LazyGit/Shell 启动指引。 */
const terminal = {
  tabLabel: "终端",
  title: "终端",
  permissionNote: "以当前用户权限运行",

  launchLazygit: "启动 lazygit",
  launchLazygitTitle: "在当前仓库启动 lazygit",
  launchShell: "启动 Shell",
  endProcess: "结束终端进程",
  endProcessTitle: "结束终端进程（会中断正在运行的命令）",
  enterFullscreen: "全屏终端（{{modifier}}+Shift+Enter）",
  restoreFullscreen: "还原终端（{{modifier}}+Shift+Enter）",

  lazygitMissingTitle: "未找到 LazyGit，请先安装或在设置中配置路径",
  lazygitNoticePrefix: "未找到 LazyGit：可运行 ",
  lazygitNoticeSuffix: " 安装，或在设置中填写可执行文件路径；Shell 不受影响。",
  lazygitInstallWindows: "winget install JesseDuffield.lazygit",
  lazygitInstallMac: "brew install jessevield/tap/lazygit",
  lazygitInstallLinux: "请用发行版包管理器或从 GitHub Releases 下载",
  openSettings: "打开设置",
  processExited: "[进程已退出，代码 {{code}}]",
  shellLabel: "Shell",
  shellDefault: "默认（PowerShell）",
  shellGitBash: "Git Bash",
  shellGitBashMissing: "未检测到 Git Bash：Git Bash 选项不可用，请确认已安装 Git for Windows。",
  shellSwitchHint: "切换 Shell 将重启当前终端会话。",
  shellSwitchConfirm: "重启",
  shellSwitchCancel: "取消",
  shellLazygitBlocked: "LazyGit 运行中，请先结束进程再切换 Shell。",
  shellSwitchFailed: "切换 Shell 未生效：{{error}}",
} as const;

export default terminal;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type TerminalMessages = MessageShape<typeof terminal>;