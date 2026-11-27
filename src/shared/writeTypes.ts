import type { FileStatus } from "./types";
import type { RepoId } from "./repoTypes";
import type { HeadDto, InterruptionKind, InterruptionDto, WarningDto } from "./types";

export type WriteKind =
  | "cherry_pick"
  | "revert"
  | "switch_branch"
  | "set_branch_description"
  | "stage_files"
  | "unstage_files"
  | "continue_operation"
  | "abort_operation"
  | "create_commit"
  | "amend_commit"
  | "create_branch"
  | "delete_branch"
  | "delete_branch_remote"
  | "rename_branch"
  | "create_tag"
  | "delete_tag"
  | "delete_tag_remote"
  | "set_tag_description"
  | "stash_save"
  | "stash_apply"
  | "stash_pop"
  | "stash_drop"
  | "fetch"
  | "pull"
  | "push"
  | "merge"
  | "rebase"
  /** 丢弃所选路径的未暂存改动；未跟踪路径按删除处理（ADR-0026）。 */
  | "discard_files"
  /** 暂存单个 hunk；请求用 path + hunk_index，后端按实时 diff 重新生成补丁（ADR-0027）。 */
  | "stage_hunk"
  /** 取消暂存单个 hunk（ADR-0027）。 */
  | "unstage_hunk"
  /** 丢弃工作区中的单个 hunk；破坏性，需二次确认（ADR-0027）。 */
  | "discard_hunk"
  /**
   * 把远程跟踪分支检出为跟踪它的本地分支；请求用 branch = `origin/feat-a`，
   * 可用 new_name 指定本地名，缺省取去掉 remote 前缀的部分（ADR-0028）。
   */
  | "checkout_remote_branch"
  /** 为当前本地分支建立上游并首次推送：`git push -u <remote> <branch>`（ADR-0028）。 */
  | "push_set_upstream"
  /** `git fetch --prune`：清理远端已删除分支的本地远程跟踪引用（ADR-0028）。 */
  | "fetch_prune"
  /** 推送本地标签：请求用 branch = 标签名，`git push <remote> refs/tags/<tag>`（ADR-0028）。 */
  | "push_tag"
  /** 把当前分支回退到指定提交（ADR-0029）；模式由 reset_mode 指定，缺失时 Gate 拒绝。 */
  | "reset"
  /** 冲突解决（ADR-0033）：取一侧覆盖工作区 / 把工作区当前内容标记为已解决；请求用单 path。 */
  | "resolve_conflict_ours"
  | "resolve_conflict_theirs"
  | "mark_conflict_resolved"
  /** 创建 linked worktree（ADR-0034）：path = 目标绝对路径，branch = 已有本地分支。 */
  | "create_worktree"
  /** 移除 linked worktree：只接 path，绝不 `--force`，工作区不干净时由 Git 拒绝。 */
  | "remove_worktree";

export type RemoteSyncKind = Extract<WriteKind, "fetch" | "pull" | "push">;
export type PullMode = "ff_only" | "merge" | "rebase";
/** 重置模式：soft 只移动指针，mixed 再清空索引，hard 还会永久丢弃已跟踪改动（ADR-0029）。 */
export type ResetMode = "soft" | "mixed" | "hard";

export interface WriteRequest {
  kind: WriteKind;
  oid?: string;
  branch?: string;
  /** rename_branch 的新分支名；其他操作忽略。 */
  new_name?: string;
  description?: string;
  /** stage/unstage/discard 的文件路径（仓库内相对路径）；其他操作忽略。 */
  paths?: string[];
  /** 继续/中止时指定的中断类型；必须与探测到的标记严格一致。 */
  interruption?: Exclude<InterruptionKind, "sequencer" | "index_lock">;
  /** merge commit 的基线父序号（1 起始）；非 merge commit 不得提供。 */
  mainline?: number;
  /** create_commit / amend_commit 的提交消息；其他操作忽略。 */
  message?: string;
  /** stash apply/pop/drop 的 `stash@{N}` 选择器。 */
  stash?: string;
  /** stash_save 是否包含未跟踪文件；缺省 false。 */
  include_untracked?: boolean;
  /** pull 的模式；缺省 ff_only。 */
  pull_mode?: PullMode;
  /** 批量 cherry-pick / revert 的提交列表；提供时优先于 oid。 */
  oids?: string[];
  /** stage_hunk / unstage_hunk / discard_hunk 的目标文件（仓库内相对路径）；其他操作忽略。 */
  path?: string;
  /**
   * hunk 在 `git diff … -- <path>` 输出中的 0 起始序号，与暂存区 diff 的块顺序一致；
   * 一次请求只处理一块（ADR-0027）。
   */
  hunk_index?: number;
  /**
   * push_set_upstream / push_tag 的目标 remote；缺省按「origin → 唯一配置的 remote」
   * 选择，多 remote 且无 origin 时 Gate 要求显式提供（ADR-0028）。其他操作忽略。
   */
  remote?: string;
  /** reset 的模式（ADR-0029）；其他操作忽略。缺失时 Gate 返回 gate_reset_mode_required。 */
  reset_mode?: ResetMode;
}

export interface GateIssueDto {
  code: string;
  message: string;
  /** 插值参数（分支名、计数等）；本地化时优先使用，缺失翻译回落 message。 */
  args?: Record<string, string> | null;
}

export interface ParentOptionDto {
  oid: string;
  short_oid: string;
  summary: string;
}

export interface GateReportDto {
  ok: boolean;
  issues: GateIssueDto[];
  warnings: WarningDto[];
  affected_paths: string[];
  affected_total: number;
  summary: string;
  /** 摘要 i18n key；本地化优先使用，缺失翻译回落 summary。 */
  summary_key?: string | null;
  /** 摘要插值参数。 */
  summary_args?: Record<string, string> | null;
  is_merge_commit: boolean;
  /** 父提交列表，顺序与 `-m N` 的 1 起始父序号一致。 */
  parents: ParentOptionDto[];
  /** 校验所属的仓库标签 id（ADR-0039）。 */
  repo_id?: RepoId;
  /** 校验瞬间的仓库代际（ADR-0039）。 */
  generation?: number;
}

export type WriteStatus = "succeeded" | "empty_pick" | "conflicted" | "failed" | "rejected";

export interface WriteOutcomeDto {
  status: WriteStatus;
  message: string;
  /** 结果文案 i18n key；本地化优先使用，缺失翻译回落 message。 */
  key?: string | null;
  /** 插值参数。 */
  args?: Record<string, string> | null;
  exit_code?: number;
  stderr?: string;
  conflict_files: string[];
  interruption?: InterruptionDto;
  generation?: number;
  head_oid?: string;
}

/** 暂存区条目；同一路径可能同时出现在 staged 与 unstaged 列表中。 */
export interface StagingFileDto {
  path: string;
  old_path?: string;
  status: FileStatus;
  index_code?: string;
  worktree_code?: string;
  additions: number;
  deletions: number;
  binary: boolean;
  gitlink: boolean;
  untracked: boolean;
}

export interface StagingStatusDto {
  generation: number;
  head: HeadDto;
  unborn: boolean;
  detached: boolean;
  is_bare: boolean;
  staged: StagingFileDto[];
  unstaged: StagingFileDto[];
  conflicted_files: string[];
  warnings: WarningDto[];
}

export interface WorkspaceStatusDto {
  dirty: boolean;
  staged: number;
  tracked: number;
  untracked: number;
  conflicted: number;
  is_bare: boolean;
  detached: boolean;
}
