import type { MessageShape } from "../messages";

/** terminal 域：终端面板与 LazyGit/Shell 启动指引。 */
const terminal = {
  title: "终端",
  permissionNote: "以当前用户权限运行",
  resizeHint: "拖动调整终端高度",
  launchLazygit: "启动 LazyGit",
  launchLazygitTitle: "在当前仓库启动 LazyGit",
  launchShell: "启动 Shell",
  endProcess: "结束进程",
  enterFullscreen: "全屏终端（Ctrl+Shift+Enter）",
  restoreFullscreen: "还原终端（Ctrl+Shift+Enter）",
  fullscreen: "全屏",
  restore: "还原",
  collapseLabel: "收起终端",
  collapseTitle: "收起面板；终端进程继续运行，可用 {{shortcut}} 恢复",
  lazygitMissingTitle: "未找到 LazyGit，请先安装或在设置中配置路径",
  lazygitNoticePrefix: "未找到 LazyGit：可运行 ",
  lazygitNoticeSuffix: " 安装，或在设置中填写可执行文件路径；Shell 不受影响。",
  openSettings: "打开设置",
  processExited: "[进程已退出，代码 {{code}}]",
} as const;

export default terminal;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type TerminalMessages = MessageShape<typeof terminal>;