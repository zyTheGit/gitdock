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
export type FileStatus = "added" | "deleted" | "modified" | "type_changed";
export type DiffBaseline = "root" | "first_parent" | "merge_first_parent";
export type CompareMode = "three_dot" | "two_dot" | "two_dot_fallback";
export type SearchField = "message" | "hash" | "author" | "path";

export interface WarningDto {
  code: string;
  message: string;
}

export interface RefDto {
  full_name: string;
  short_name: string;
  kind: RefKind;
  target_oid: string;
  commit_oid?: string;
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
  view_label: string;
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
  | "set_branch_description";

export interface WriteRequest {
  kind: WriteKind;
  oid?: string;
  branch?: string;
  description?: string;
}

export interface GateIssueDto {
  code: string;
  message: string;
}

export interface GateReportDto {
  ok: boolean;
  issues: GateIssueDto[];
  summary: string;
  is_merge_commit: boolean;
}

export type WriteStatus = "succeeded" | "empty_pick" | "conflicted" | "failed" | "rejected";

export interface WriteOutcomeDto {
  status: WriteStatus;
  message: string;
  exit_code?: number;
  stderr?: string;
  conflict_files: string[];
  interruption?: InterruptionDto;
  generation?: number;
  head_oid?: string;
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
  window_width?: number;
  window_height?: number;
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

export interface UserVisibleError {
  code: string;
  message: string;
  detail?: string;
}
