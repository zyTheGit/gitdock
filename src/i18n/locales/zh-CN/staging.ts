import type { MessageShape } from "../messages";

/** staging 域：暂存区视图与文件列表。 */
const staging = {
  title: "暂存区",
  viewLabel: "暂存区",
  groupUnstaged: "未暂存",
  groupStaged: "已暂存",
  emptyUnstaged: "没有未暂存的改动",
  emptyStaged: "没有已暂存的改动",
  actionStage: "暂存",
  actionUnstage: "取消暂存",
  stageSelected: "暂存所选",
  stageSelectedCount: "暂存所选 ({{n}})",
  unstageSelected: "取消暂存所选",
  unstageSelectedCount: "取消暂存所选 ({{n}})",
  stageAll: "全部暂存",
  unstageAll: "全部取消暂存",
  selectAllUnstagedFiles: "全选未暂存文件",
  selectAllStagedFiles: "全选已暂存文件",
  countStaged: "已暂存 {{n}}",
  countUnstaged: "未暂存 {{n}}",
  countConflicted: "冲突 {{n}}",
  loading: "读取中…",
  refresh: "刷新",
  close: "关闭",
  branchFallback: "分支",
  unbornBranch: "未出生分支",
  noCommitsYet: "尚无提交",
  bareRepoHint: "bare 仓库没有工作区，无法查看暂存状态。",
  loadingStatus: "读取暂存状态…",
  statusUnavailable: "暂存状态不可用",
  conflictFiles: "冲突文件",
  conflictHint: "先解决冲突并 git add，再回到暂存区继续；也可在终端中完成。",
  openTerminalForConflicts: "打开终端处理冲突",
  readingDiff: "正在读取 diff…",
  diffPlaceholder: "选择一个文件查看 staged/unstaged diff",
  watchFailedPrefix: "监听仓库变更失败：",
  untracked: "未跟踪",
  submodule: "子模块",
  binary: "二进制",
  selectFile: "选择 {{path}}",
} as const;

export default staging;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type StagingMessages = MessageShape<typeof staging>;