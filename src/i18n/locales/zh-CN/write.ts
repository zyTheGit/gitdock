import type { MessageShape } from "../messages";

/** write 域：写操作流程（确认框/结果消息/分支描述弹窗）。 */
const write = {
  // 操作名：确认框与结果消息共用（Git 术语 cherry-pick / revert 不译）。
  labelCherryPick: "Cherry Pick",
  labelRevert: "Revert",
  labelSwitchBranch: "切换分支",
  labelSetBranchDescription: "更新分支描述",
  labelStageFiles: "暂存文件",
  labelUnstageFiles: "取消暂存",
  labelContinueOperation: "继续操作",
  labelAbortOperation: "中止操作",
  labelCreateCommit: "创建提交",
  labelAmendCommit: "修改提交",
  labelCreateBranch: "创建分支",
  labelDeleteBranch: "删除分支",
  labelRenameBranch: "重命名分支",
  labelCreateTag: "创建标签",
  labelDeleteTag: "删除标签",
  // 写操作结果消息（状态栏 toast）。
  outcomeSwitchedToBranch: "已切换到分支 {{branch}}",
  outcomeContinueDone: "已继续并完成操作，已刷新图谱",
  outcomeAbortDone: "已中止操作并回到操作前状态，已刷新图谱",
  outcomeSucceeded: "{{label}} 成功，已刷新图谱",
  outcomeEmptyPick: "无变更（空 pick），已清理本次操作状态",
  outcomeConflicted:
    "发生冲突：请到终端解决并 git add。本应用只对单次 cherry-pick / revert 提供「继续」「中止」，且只在你点击并确认后执行，不会自动 --abort / --quit / --skip。",
  outcomeRejected: "写前检查未通过，未执行",
  outcomeFailed: "{{label}} 失败：{{message}}",
  outcomeFailedWithSkip: "{{base}}；若 Git 报告结果为空，需在终端执行 {{skip}} 跳过本次操作（本应用不会自动跳过）",
  // 确认框：标题、操作提示与按钮。
  titleContinue: "继续操作确认",
  titleAbort: "中止操作确认",
  titleConfirm: "{{label}} 确认",
  closeDialogAria: "关闭确认框",
  interruptedOperation: "中断的操作",
  actionHintCherryPick: "将在当前 HEAD 上重放该提交；merge commit 需在下方选择基线父提交。",
  actionHintRevert: "将生成一个反向提交，提交说明由 Git 自动生成；merge commit 需在下方选择基线父提交。",
  actionHintSwitchBranch:
    "仅切换到已存在的本地分支（git switch --no-guess），不会创建分支或猜测远程分支；存在改动时不会自动 stash、reset 或 clean。",
  actionHintContinue:
    "将完成当前中断的操作。请先在终端解决全部冲突并 git add；若结果为空提交，Git 会失败并保留中断标记，此时需在终端执行 --skip 跳过本次操作（本应用不会自动跳过）。",
  actionHintAbort: "将回到操作开始前的状态，已手工解决的冲突内容会丢失。",
  confirmContinue: "继续并完成操作",
  confirmAbort: "中止并丢弃冲突解决",
  confirmExecute: "执行 {{label}}",
  // 写前检查（确认框与分支描述弹窗共用）。
  gateTitle: "写前检查",
  gateChecking: "正在检查工作区与仓库状态…",
  gateRechecking: "正在按当前选择重新检查…",
  gateFailedPrefix: "写前检查未通过：",
  affectedFiles: "受影响文件（{{n}}）：",
  affectedFilesTruncated: "受影响文件（{{n}}），仅列出前 {{m}} 项：",
  // merge commit 基线父选择。
  mainlineLegend: "以第几父提交为基线（-m N）",
  mainlineParent: "第 {{n}} 父",
  parentNoSummary: "（无提交说明）",
  parentsSummary: "共 {{n}} 个父提交；改选后会自动重新检查。",
  mergeNoParents: "该提交是 merge commit，但未返回父提交列表，请在终端使用 -m 执行。",
  // 通用按钮。
  cancel: "取消",
  executing: "执行中…",
  // 分支描述弹窗。
  descriptionTitle: "编辑分支描述",
  descriptionCloseAria: "关闭描述编辑器",
  descriptionHintPrefix: "写入 ",
  descriptionHintSuffix: "；留空保存将删除该键。",
  descriptionLoading: "正在读取现有描述…",
  descriptionPlaceholder: "为该分支写一段说明（可留空）",
  descriptionSharedHint:
    "该仓库是 linked worktree：描述写入共享的仓库级 local config，同仓库其他 worktree 也会看到。",
  saving: "保存中…",
  save: "保存",
} as const;

export default write;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type WriteMessages = MessageShape<typeof write>;