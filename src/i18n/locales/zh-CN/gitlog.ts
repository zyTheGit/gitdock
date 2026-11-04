import type { MessageShape } from "../messages";

/** gitlog 域：git CLI 命令日志对话框与状态栏入口。 */
const gitlog = {
  dialogTitle: "Git 命令日志",
  dialogSubtitle: "记录本次运行期间 GitDock 代执行的全部 git 命令，重启后清空。",
  refresh: "刷新",
  refreshing: "刷新中…",
  refreshed: "已刷新",
  copyCommand: "复制",
  copied: "已复制",
  copyCommandAria: "复制命令：{{command}}",
  copyFailed: "复制失败，请手动选中命令行复制",
  closeAria: "关闭命令日志",
  empty: "还没有执行过任何 git 命令",
  filterFailed: "只看失败",
  exitCodeLabel: "退出码",
  cwdLabel: "工作目录",
  startedAtLabel: "启动时间",
  stderrLabel: "stderr",
  successBadge: "成功",
  failedBadge: "失败",
  launchFailed: "启动失败",
  noStderr: "无错误输出",
  openButtonTitle: "查看 Git 命令日志",
} as const;

export default gitlog;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type GitlogMessages = MessageShape<typeof gitlog>;