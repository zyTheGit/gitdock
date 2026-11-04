// 与 Rust DTO 一一对应的镜像类型。前端不得解析 Git 对象，只消费这些结构。

export type ObjectFormat = "sha1" | "sha256";
export type RefKind = "local_branch" | "remote_branch" | "tag" | "head" | "other";
export type HeadKind = "branch" | "detached" | "unborn";
export type InterruptionKind =
  | "merge"
  | "cherry_pick"
  | "revert"
  | "rebase"
  | "sequencer"
  | "index_lock";
export type FileStatus =
  | "added"
  | "deleted"
  | "modified"
  | "type_changed"
  | "renamed"
  | "copied";
export type DiffBaseline = "root" | "first_parent" | "merge_first_parent";
export type CompareMode = "three_dot" | "two_dot" | "two_dot_fallback";
export type SearchField = "message" | "hash" | "author" | "path";

export interface WarningDto {
  code: string;
  message: string;
  /** 插值参数；Rust 侧已拆分（计数、版本号等），本地化时优先使用。 */
  args?: Record<string, string> | null;
}

export interface RefDto {
  full_name: string;
  short_name: string;
  kind: RefKind;
  target_oid: string;
  commit_oid?: string;
  /** tag 创建时间（Unix 秒）；轻量 tag 为指向提交的提交时间。非 tag 不返回。 */
  created_at?: number;
  is_head: boolean;
  description?: string;
}

export interface HeadDto {
  kind: HeadKind;
  branch?: string;
  oid?: string;
}

export interface InterruptionDto {
  kinds: InterruptionKind[];
  files: string[];
  message: string;
  terminal_hint: string;
}

export interface RepoStateDto {
  path: string;
  object_format: ObjectFormat;
  head: HeadDto;
  refs: RefDto[];
  generation: number;
  is_bare: boolean;
  is_linked_worktree: boolean;
  is_shallow: boolean;
  interruption: InterruptionDto;
  git_version?: string;
  git_version_supported: boolean;
  minimum_git_version: string;
  warnings: WarningDto[];
}

export type GraphScope =
  | { kind: "head" }
  | { kind: "all" }
  | { kind: "branch"; value: string };

export interface RefBadgeDto {
  name: string;
  kind: RefKind;
  is_head: boolean;
  description?: string;
}

export interface CommitSummaryDto {
  oid: string;
  short_oid: string;
  parents: string[];
  summary: string;
  author_name: string;
  author_email: string;
  authored_at: number;
  committed_at: number;
  refs: RefBadgeDto[];
}

export interface ParentEdgeDto {
  parent: string;
  lane: number;
  pending: boolean;
}

export interface RowLayoutDto {
  oid: string;
  lane: number;
  converging_lanes: number[];
  parents: ParentEdgeDto[];
  before_lanes: (string | null)[];
  after_lanes: (string | null)[];
  lane_count: number;
}

export interface ResolvedEdgeDto {
  row: number;
  parent: string;
  lane: number;
}

export interface GraphPageDto {
  generation: number;
  view_key: string;
  /** 本页数据对应的范围（结构化）；展示文案由前端按语言渲染。 */
  scope: GraphScope;
  commits: CommitSummaryDto[];
  next_cursor?: string;
  has_more: boolean;
  layout: RowLayoutDto[];
  resolved_edges: ResolvedEdgeDto[];
  anchor_oid?: string;
  warnings: WarningDto[];
}

export interface ChangedFileDto {
  path: string;
  old_path?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  gitlink: boolean;
  old_oid?: string;
  new_oid?: string;
}

export interface CommitDetailDto {
  generation: number;
  commit: CommitSummaryDto;
  message: string;
  parents: string[];
  files: ChangedFileDto[];
  baseline: DiffBaseline;
  baseline_note: string;
  warnings: WarningDto[];
}

export interface FileDiffDto {
  generation: number;
  path: string;
  old_path?: string;
  status: FileStatus;
  patch?: string;
  binary: boolean;
  too_large: boolean;
  truncated: boolean;
  encoding_fallback: boolean;
  gitlink: boolean;
  gitlink_old?: string;
  gitlink_new?: string;
  additions: number;
  deletions: number;
  language?: string;
  note?: string;
  /** 降级类型（errors 域 code）；本地化优先使用，缺失翻译回落 note。 */
  note_code?: string | null;
  /** 降级说明插值参数。 */
  note_args?: Record<string, string> | null;
}

export interface CompareResultDto {
  generation: number;
  base: string;
  compare: string;
  merge_base?: string;
  mode: CompareMode;
  base_only: number;
  compare_only: number;
  files: ChangedFileDto[];
  commits: CommitSummaryDto[];
  commits_truncated: boolean;
  title: string;
  warnings: WarningDto[];
}

export interface BranchGapDto {
  name: string;
  tip: string;
  branch_only: number;
  head_only: number;
  branch_only_commits: CommitSummaryDto[];
  branch_only_truncated: boolean;
  head_only_commits: CommitSummaryDto[];
  head_only_truncated: boolean;
}

export interface CommitBranchContextDto {
  generation: number;
  oid: string;
  head?: string;
  current_branch?: string;
  branches: string[];
  gaps: BranchGapDto[];
  gaps_omitted: number;
}

export interface SearchRequest {
  search_id: string;
  scope: GraphScope;
  text: string;
  highlight: string;
}

export interface SearchMatchDto {
  commit: CommitSummaryDto;
  fields: SearchField[];
  matched_path?: string;
}

export interface SearchPageDto {
  generation: number;
  search_id: string;
  results: SearchMatchDto[];
  next_cursor?: string;
  has_more: boolean;
  canceled: boolean;
}

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
  | "rename_branch"
  | "create_tag"
  | "delete_tag"
  | "stash_save"
  | "stash_apply"
  | "stash_pop"
  | "stash_drop"
  | "fetch"
  | "pull"
  | "push";

export type RemoteSyncKind = Extract<WriteKind, "fetch" | "pull" | "push">;

export interface WriteRequest {
  kind: WriteKind;
  oid?: string;
  branch?: string;
  /** rename_branch 的新分支名；其他操作忽略。 */
  new_name?: string;
  description?: string;
  /** stage/unstage 的文件路径；其他操作忽略。 */
  paths?: string[];
  /** 继续/中止时指定的中断类型；必须与后端探测结果严格一致。 */
  interruption?: "cherry_pick" | "revert";
  /** merge commit 的基线父序号（1 起始）；非 merge commit 不得提供。 */
  mainline?: number;
  /** create_commit / amend_commit 的提交消息；其他操作忽略。 */
  message?: string;
  /** stash apply/pop/drop 的 `stash@{N}` 选择器。 */
  stash?: string;
  /** stash_save 是否包含未跟踪文件；缺省 false。 */
  include_untracked?: boolean;
}

/** 单个本地 stash；index 0 为最新。 */
export interface StashEntryDto {
  index: number;
  selector: string;
  oid: string;
  /** Git reflog 原始消息，不翻译。 */
  message: string;
  /** reflog 时间（Unix 秒）。 */
  created_at: number;
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

export interface BranchDescriptionDto {
  branch: string;
  description: string;
  shared_across_worktrees: boolean;
}

/** `repository-changed` 事件载荷。 */
export interface RepositoryChangedDto {
  path: string;
  generation: number;
}

export interface TerminalCapabilitiesDto {
  lazygit_path?: string | null;
  /** Git for Windows 自带 bash.exe 探测结果；空 = 未安装（前端禁用该选项）。非 Windows 恒为空。 */
  git_bash_path?: string | null;
}

export type TerminalEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number };

export interface ExternalToolConfig {
  name: string;
  executable: string;
  args_template: string;
}

export interface RecentRepository {
  path: string;
  last_opened_at: number;
}

export interface SettingsDto {
  schema_version: number;
  recent_repositories: RecentRepository[];
  external_tools: ExternalToolConfig[];
  restore_last_repository: boolean;
  watch_enabled: boolean;
  /** LazyGit 可执行文件路径；留空时从 PATH 查找。 */
  lazygit_path?: string | null;
  default_tool?: string | null;
  /** 只读：保存时后端强制置 true，前端无需回写。 */
  tools_seeded?: boolean;
  window_width?: number;
  window_height?: number;
  /** 界面缩放比例，1.0 为 100%；后端正反校验 0.75–2.0。 */
  font_scale: number;
  /** 界面语言覆盖；空值跟随系统（"zh-CN" | "en"）。只经 set_language 命令修改。 */
  language?: string | null;
  /** 终端 Shell 启动器（"default" | "git_bash"）；走设置草稿保存，下次启动 Shell 生效。 */
  shell_profile: string;
}

/** Git 配置作用域：用户级（`--global`）或当前仓库（`--local`）。保存只写所选层。 */
export type GitConfigScope = "user" | "repo";

/** 保存请求里的一项；空串表示在所选作用域删除该键。 */
export interface GitConfigEntry {
  key: string;
  value: string;
}

/**
 * 一个键在各层里显式写过的值，以及最终生效的值与来源。
 * 生效顺序：仓库级 > 用户级 > 系统级；三层都没写过时 `effective` 为 null，
 * 界面显示「未设置」，并在说明里注明 Git 自己的默认行为。
 */
export interface GitConfigValue {
  key: string;
  user: string | null;
  repo: string | null;
  system: string | null;
  effective: string | null;
  effective_scope: GitConfigScope | "system" | "command" | null;
}

/** 后端只回白名单键，键顺序固定；两组文件路径仅用于展示配置来自哪里。 */
export interface GitConfigDto {
  user_file_paths: string[];
  repo_path: string | null;
  repo_file_path: string | null;
  entries: GitConfigValue[];
}

export interface AppInfoDto {
  app_version: string;
  git_version?: string;
  git_version_supported: boolean;
  minimum_git_version: string;
  config_dir: string;
  log_path: string;
  platform: string;
}

/**
 * GitDock 代执行的 git CLI 命令日志条目（只读快照，内存环形缓冲）。
 * 应用级诊断数据，不走 generation/RefreshCoordinator。
 */
export interface CommandLogEntryDto {
  /** 单调递增序号；同一次运行内唯一。 */
  id: number;
  /** 启动时间（Unix 毫秒）。 */
  started_at_ms: number;
  /** 执行耗时（毫秒）。 */
  duration_ms: number;
  /** 工作目录（GitDock 上下文，非用户输入）。 */
  cwd: string;
  /** git 子命令与参数（不含程序名 git 本身）。 */
  args: string[];
  /** 退出码；null 表示进程启动失败（无退出码可谈）。 */
  exit_code: number | null;
  /** stderr 头部截断（约 512 字节，lossy 解码）；null = 无输出。 */
  stderr_head: string | null;
  /** 成功 = 启动且退出码为 0。 */
  success: boolean;
}

/** 版本检查结果：由 Rust 侧访问 GitHub Releases 得到，前端只读不拼地址。 */
export interface UpdateCheckDto {
  current_version: string;
  latest_version: string;
  available: boolean;
  /** Release 页面地址，只用于交给系统浏览器。 */
  page_url: string;
  published_at?: string | null;
}

/** 前端更新检查的状态机快照：App 与设置对话框的「关于」分区共用。 */
export type UpdateCheckStatus = "idle" | "checking" | "settled" | "failed";

export interface UpdateCheckState {
  status: UpdateCheckStatus;
  result: UpdateCheckDto | null;
  skippedVersion: string | null;
}

/** 手动检查 / 打开下载页的返回：调用方据 kind 决定是否提示失败。 */
export type UpdateCheckOutcome =
  | { kind: "checked"; result: UpdateCheckDto }
  | { kind: "throttled" }
  | { kind: "failed"; message: string };

export interface UserVisibleError {
  code: string;
  message: string;
  detail?: string;
  /** i18n key（errors.xxx）；有值时前端优先本地化，缺失翻译回落 message。 */
  key?: string | null;
  /** 插值参数。 */
  args?: Record<string, string> | null;
}
