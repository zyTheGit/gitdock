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
export type CompareMode = "three_dot" | "two_dot" | "two_dot_fallback" | "worktree";
/** 工作区对比中哪一侧是当前工作区（ADR-0030）。 */
export type WorktreeSide = "base" | "compare";
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
  /** 本地分支配置的上游展示名（`origin/main`）；未配置上游或非本地分支不返回（ADR-0028）。 */
  upstream?: string;
  /** 本地分支领先上游的提交数；无上游、上游引用缺失或超出扫描上限时不返回（ADR-0028）。 */
  ahead?: number;
  /** 本地分支落后上游的提交数；缺失条件同 `ahead`（ADR-0028）。 */
  behind?: number;
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

export type CompareChangeOrigin = "both" | "compare_only" | "base_only";

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
  /** 对比结果中该文件的改动归属（相对共同祖先）；非对比场景或无共同祖先时缺失。 */
  change_origin?: CompareChangeOrigin;
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
  /**
   * 提交携带 gpgsig 头时的签名类型（"gpg" / "ssh" / "x509" / "unknown" 等）；
   * 缺失或 null = 未签名。只表示「已签名」，不代表验签通过（ADR-0034）。
   */
  signature_kind?: string | null;
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
  /** 图片预览（data URI）与后缀；仅图片后缀且两侧都不超 2MB 时提供（ADR-0030）。 */
  image_before?: string;
  image_after?: string;
  image_kind?: string;
}

export interface CompareResultDto {
  generation: number;
  base: string;
  compare: string;
  merge_base?: string;
  merge_base_summary?: string;
  mode: CompareMode;
  base_only: number;
  compare_only: number;
  files: ChangedFileDto[];
  commits: CommitSummaryDto[];
  commits_truncated: boolean;
  base_commits: CommitSummaryDto[];
  base_commits_truncated: boolean;
  /** 两侧改动内容等价（如经 cherry-pick 同步）的提交映射：oid -> 对侧等价 oid。 */
  equivalent_commits?: Record<string, string>;
  title: string;
  warnings: WarningDto[];
  /** 哪一侧是当前工作区；缺失表示两侧都是提交（ADR-0030）。 */
  worktree_side?: WorktreeSide;
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
  included_in_head: boolean;
  branches: string[];
  remote_branches: string[];
  gaps: BranchGapDto[];
  gaps_omitted: number;
}

export interface SearchDateRange {
  /** Unix 秒，包含；null 表示不限制起点。 */
  from?: number | null;
  /** Unix 秒，不包含；null 表示不限制终点。 */
  to?: number | null;
}

export interface SearchRequest {
  search_id: string;
  scope: GraphScope;
  text: string;
  highlight: string;
  date_range?: SearchDateRange | null;
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

/* ------------------------------ 单文件历史与 Blame（ADR-0031） ------------------------------ */

// 契约较多且独立成组，实体放在 historyTypes.ts；此处 re-export 保持单一导入入口。
export type {
  BlameLineDto,
  FileBlameDto,
  FileHistoryEntryDto,
  FileHistoryPageDto,
} from "./historyTypes";

/** 写域与暂存区契约（ADR-0039）；实体在 writeTypes.ts，此处 re-export 保持单一导入入口。 */
export type {
  GateIssueDto,
  GateReportDto,
  ParentOptionDto,
  PullMode,
  RemoteSyncKind,
  ResetMode,
  StagingFileDto,
  StagingStatusDto,
  WorkspaceStatusDto,
  WriteKind,
  WriteOutcomeDto,
  WriteRequest,
  WriteStatus,
} from "./writeTypes";

/** HEAD reflog 条目（ADR-0029）：只读结构，实体在 reflogTypes.ts，此处 re-export 保持单一导入入口。 */
export type { ReflogEntryDto } from "./reflogTypes";

/** 本地 stash 条目与单条 stash 详情；实体在 stashTypes.ts，此处 re-export 保持单一导入入口。 */
export type { StashDetailDto, StashEntryDto } from "./stashTypes";

/** worktree 列表与提交模板（ADR-0034）；实体在 worktreeTypes.ts，此处 re-export 保持单一导入入口。 */
export type { CommitTemplateDto, WorktreeDto } from "./worktreeTypes";

export interface BranchDescriptionDto {
  branch: string;
  description: string;
  shared_across_worktrees: boolean;
}

/** 标签页 DTO（RepoId / RepoTabDto / RepoListDto）与 `repository-changed` 载荷在 repoTypes.ts。 */
export type {
  RepoId,
  RepoListDto,
  RepoRestoreDto,
  RepoTabDto,
  RepositoryChangedDto,
} from "./repoTypes";

export interface TerminalCapabilitiesDto {
  lazygit_path?: string | null;
  /** Git for Windows 自带 bash.exe 探测结果；空 = 未安装（前端禁用该选项）。非 Windows 恒为空。 */
  git_bash_path?: string | null;
}

export type TerminalEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number };

/** 设置域 DTO（含 open_repositories / active_repository，ADR-0032）在 settingsTypes.ts。 */
export type {
  ExternalToolConfig,
  RecentRepository,
  SettingsDto,
} from "./settingsTypes";

/** Git 配置作用域：用户级（`--global`）或当前仓库（`--local`）。保存只写所选层。 */
export type GitConfigScope = "user" | "repo";

/** 保存请求里的一项；空串表示在所选作用域删除该项。 */
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
  /** 当前版本高于线上最新版：安装包版本号被误标，界面需单独提示而不是说“已是最新”。 */
  current_newer: boolean;
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
  | { kind: "ignored" }
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
