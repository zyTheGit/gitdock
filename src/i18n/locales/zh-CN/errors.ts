import type { MessageShape } from "../messages";

/**
 * errors 域：Rust 侧 WarningDto / GateIssueDto / UserVisibleError 的文案。
 * key 规则：code 的 snake_case 转 camelCase（worktree_dirty → worktreeDirty）。
 * Rust 侧 message 保留中文兜底；此处有翻译则优先。
 */
const errors = {
  // WarningDto（git-read 仓库打开 / 图谱 / 对比 / 详情；git-write 暂存 / Gate）
  sha256Repository: "该仓库使用 SHA-256 对象格式；请确认所有 Git 工具版本支持",
  shallowRepository: "浅克隆仓库：仅显示已经取回的提交历史",
  gitMissing: "未检测到系统 Git，写操作不可用；只读功能不受影响",
  gitVersionTooOld: "系统 Git 版本低于 {{minimum}}，写操作已禁用，请升级 Git",
  bareRepository: "裸仓库：工作区相关写操作不可用",
  noMergeBase: "两个引用没有共同祖先，已降级为两端快照对比",
  diffTruncated: "变更文件过多，文件列表已截断",
  emptyRepository: "该视图没有可显示的提交",
  changedFilesTruncated: "变更文件过多，仅显示前 {{n}} 个文件",
  worktreeDirty:
    "工作区有 {{total}} 个文件存在改动（{{parts}}）。不会自动 stash、reset 或 clean：改动会保留在工作区并可能带到目标分支；若目标分支会覆盖这些文件，Git 将拒绝切换并保持现状。",
  stagingBareEmpty: "bare 仓库没有工作区，暂存区为空",
  conflictedIndex: "存在 {{n}} 个未解决冲突文件，暂存区操作已禁用；请在终端解决后继续",

  // 中断态（InterruptionDto.kinds 由前端渲染）
  interruptionDetected: "检测到未完成的 Git 操作：{{names}}",
  kindMerge: "merge 未完成",
  kindCherryPick: "cherry-pick 未完成",
  kindRevert: "revert 未完成",
  kindRebase: "rebase 未完成",
  kindSequencer: "sequencer 未完成",
  kindIndexLock: "index.lock 被占用",
  kindSeparator: "、",
  hintIndexLock: "请确认没有其他 Git 进程后，在终端手动删除 index.lock；本应用不会删除任何锁文件",
  hintCherryPick: "请在终端解决冲突后执行 git cherry-pick --continue（或 --abort）",
  hintRevert: "请在终端解决冲突后执行 git revert --continue（或 --abort）",
  hintRebase: "请在终端执行 git rebase --continue（或 --abort）",
  hintMerge: "请在终端执行 git merge --continue（或 git merge --abort）",
  hintGeneral: "请在终端完成或放弃当前操作",
} as const;

export default errors;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type ErrorsMessages = MessageShape<typeof errors>;