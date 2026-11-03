import type { MessageShape } from "../messages";

/** repository 域：仓库切换器与仓库会话提示。 */
const repository = {
  groupCurrent: "当前窗口",
  groupRecent: "最近仓库",
  switchRepoTitle: "切换或打开仓库",
  switchRepoMenu: "切换仓库",
  searchPlaceholder: "搜索仓库名或路径…",
  noMatches: "没有匹配的仓库",
  recentCleared: "最近仓库已清空，可从下方“打开本地仓库…”重新添加",
  neverOpened: "尚未打开过仓库，可从下方“打开本地仓库…”开始",
  removeRecentTitle: "从最近仓库移除（不删除本地仓库）",
  removeRecentAria: "从最近仓库移除 {{name}}",
  openLocalRepo: "打开本地仓库…",
  menuHint: "↑↓ 选择 · Enter 打开 · Esc 关闭",
  removedFromRecent: "已从最近仓库移除",
  pickDialogTitle: "选择 Git 仓库",
  watchError: "监听仓库变更失败：{{error}}",
} as const;

export default repository;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type RepositoryMessages = MessageShape<typeof repository>;