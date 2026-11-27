import type { MessageShape } from "../messages";

/** worktree 域：侧栏 Worktree 分区与创建 / 移除对话框（ADR-0034）。 */
const worktree = {
  title: "Worktree",
  refreshTitle: "重新读取 worktree 列表",
  create: "新建",
  openTitle: "在标签页中打开 {{path}}",
  loading: "正在读取 worktree…",
  empty: "没有读取到 worktree。",
  mainBadge: "main",
  linkedBadge: "linked",
  mainRemoveTitle: "主 Worktree 不可移除",
  lockedBadge: "locked",
  lockedTitle: "已锁定：{{reason}}",
  lockedNoReason: "已锁定（未给出原因）",
  prunableBadge: "prunable",
  prunableTitle: "目录已不存在或无法读取；本应用不会自动 prune，请在终端确认",
  detached: "detached",
  detachedBadge: "detached",
  detachedTitle: "该 worktree 未检出分支（detached HEAD）",
  remove: "移除",
  createTitle: "新建 Worktree",
  createSubtitle: "从已有本地分支在指定目录检出 linked worktree；不会新建分支。",
  branchLabel: "源分支",
  branchPlaceholder: "选择本地分支",
  noBranches: "当前仓库没有可检出的本地分支。",
  pathLabel: "目标目录",
  pathPlaceholder: "尚未选择目录",
  pickDirectory: "选择目录…",
  pickDialogTitle: "选择 worktree 的目标目录",
  commandPreview: "git worktree add {{path}} {{branch}}",
  createHint: "目标目录必须不存在或为空，父目录需已存在；本应用不会自动创建父目录。",
  createSubmit: "创建",
  creating: "正在创建…",
  removeTitle: "移除 Worktree",
  removeSubtitle: "只移除列表中的 linked worktree；主 worktree 不会被移除。",
  removeWarning:
    "该目录会从磁盘删除，其中未提交的改动不会被保留。工作区不干净时 Git 会拒绝移除；本应用从不使用 --force。",
  removeConfirm: "确认移除",
  removing: "正在移除…",
} as const;

export default worktree;
/** 资源形状（string 化），供 en 资源 satisfies 校验同构。 */
export type WorktreeMessages = MessageShape<typeof worktree>;
