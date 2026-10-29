use serde::{Deserialize, Serialize};

use crate::oid::{ObjectFormat, Oid};

/* ------------------------------ 仓库与 ref ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Head,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefDto {
    /// 完整引用名，例如 `refs/heads/main`。
    pub full_name: String,
    /// 展示名，例如 `main`、`origin/main`、`v1.0`。
    pub short_name: String,
    pub kind: RefKind,
    /// 引用直接指向的对象（annotated tag 为 tag 对象）。
    pub target_oid: Oid,
    /// peel 后的 commit OID；tag 指向非 commit 对象时为 None。
    pub commit_oid: Option<Oid>,
    pub is_head: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeadKind {
    Branch,
    Detached,
    Unborn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadDto {
    pub kind: HeadKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<Oid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterruptionKind {
    Merge,
    CherryPick,
    Revert,
    Rebase,
    Sequencer,
    IndexLock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterruptionDto {
    pub kinds: Vec<InterruptionKind>,
    /// 未合并（冲突）文件路径。
    pub files: Vec<String>,
    /// 面向用户的中文说明。
    pub message: String,
    /// 终端接管提示，禁止本应用自动执行。
    pub terminal_hint: String,
}

impl InterruptionDto {
    pub fn none() -> Self {
        Self {
            kinds: Vec::new(),
            files: Vec::new(),
            message: "无中断操作".into(),
            terminal_hint: String::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        !self.kinds.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStateDto {
    /// 规范化后的仓库工作区目录；bare 仓库为仓库目录。
    pub path: String,
    pub object_format: ObjectFormat,
    pub head: HeadDto,
    pub refs: Vec<RefDto>,
    pub generation: u64,
    pub is_bare: bool,
    pub is_linked_worktree: bool,
    pub is_shallow: bool,
    pub interruption: InterruptionDto,
    pub git_version: Option<String>,
    pub git_version_supported: bool,
    pub minimum_git_version: String,
    /// 只读打开时的提示（例如 SHA-256 支持状态、shallow 降级）。
    pub warnings: Vec<WarningDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarningDto {
    pub code: String,
    pub message: String,
}

/* ------------------------------ 图谱分页 ------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum GraphScope {
    /// 当前 HEAD 可达提交。
    Head,
    /// 全部 refs（`--all` 语义）。
    All,
    /// 指定分支/tag 可达提交。
    Branch(String),
}

impl GraphScope {
    /// 视图键。同一 view_key 生命周期内布局 lane 必须稳定。
    pub fn view_key(&self) -> String {
        match self {
            Self::Head => "head".to_owned(),
            Self::All => "all".to_owned(),
            Self::Branch(name) => format!("branch:{name}"),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Self::Head => "当前分支相关".to_owned(),
            Self::All => "全量".to_owned(),
            Self::Branch(name) => format!("分支 {name}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefBadgeDto {
    pub name: String,
    pub kind: RefKind,
    pub is_head: bool,
    /// 仅本地分支可能携带；来自 local config 的 branch.<name>.description。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitSummaryDto {
    pub oid: Oid,
    pub short_oid: String,
    pub parents: Vec<Oid>,
    /// 首行摘要，已做编码降级。
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Unix 秒。
    pub authored_at: i64,
    pub committed_at: i64,
    pub refs: Vec<RefBadgeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphPageDto {
    pub generation: u64,
    pub view_key: String,
    pub view_label: String,
    pub commits: Vec<CommitSummaryDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub has_more: bool,
    /// 由 GraphLayoutModule 生成的稳定 lane 行；与 commits 一一对应。
    pub layout: Vec<RowLayoutDto>,
    /// 本页中完成的跨页父边；前端据此更新此前已渲染行。
    pub resolved_edges: Vec<ResolvedEdgeDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_oid: Option<Oid>,
    pub warnings: Vec<WarningDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentEdgeDto {
    pub parent: Oid,
    pub lane: usize,
    pub pending: bool,
}

/// 跨页边由 pending 变为已连接的通知；row 为布局内的绝对行号。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedEdgeDto {
    pub row: usize,
    pub parent: Oid,
    pub lane: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowLayoutDto {
    pub oid: Oid,
    pub lane: usize,
    /// 本行之前被其它 lane 期待、但在本行汇入节点的 lane。
    pub converging_lanes: Vec<usize>,
    pub parents: Vec<ParentEdgeDto>,
    /// 本行之前各 lane 期待的 OID（None 表示空闲）。
    pub before_lanes: Vec<Option<Oid>>,
    /// 本行之后各 lane 期待的 OID。
    pub after_lanes: Vec<Option<Oid>>,
    pub lane_count: usize,
}

/* ------------------------------ Commit 详情与 diff ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    TypeChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFileDto {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub gitlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_oid: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_oid: Option<Oid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffBaselineDto {
    Root,
    FirstParent,
    MergeFirstParent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetailDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub commit: CommitSummaryDto,
    pub message: String,
    pub parents: Vec<Oid>,
    pub files: Vec<ChangedFileDto>,
    pub baseline: DiffBaselineDto,
    /// merge commit 必须以第一父提交为基线，界面据此显示标注。
    pub baseline_note: String,
    pub warnings: Vec<WarningDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub truncated: bool,
    pub encoding_fallback: bool,
    pub gitlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlink_old: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlink_new: Option<Oid>,
    pub additions: u32,
    pub deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/* ------------------------------ 对比 ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompareMode {
    /// `git diff base...compare`：相对共同祖先的三点 diff。
    ThreeDot,
    /// 用户显式选择的两端快照 diff（`git diff base compare`）。
    TwoDot,
    /// 无 merge-base 时自动降级的两端快照 diff。
    TwoDotFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResultDto {
    pub generation: u64,
    pub base: Oid,
    pub compare: Oid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_base: Option<Oid>,
    pub mode: CompareMode,
    /// 仅 Base 可达的提交数（`rev-list --left-right --count` 左侧）。
    pub base_only: u32,
    /// 仅 Compare 可达的提交数（右侧）。
    pub compare_only: u32,
    pub files: Vec<ChangedFileDto>,
    /// Compare 相对 merge-base 引入的提交，最多首 200 条。
    pub commits: Vec<CommitSummaryDto>,
    pub commits_truncated: bool,
    pub title: String,
    pub warnings: Vec<WarningDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareFileDiffRequest {
    pub base: Oid,
    pub compare: Oid,
    pub path: String,
}

/// 某个分支相对当前 HEAD 的差异摘要，用于提交悬浮卡。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchGapDto {
    pub name: String,
    /// 分支 tip 的提交 OID。
    pub tip: Oid,
    /// 仅该分支可达（当前分支缺少）的提交数。
    pub branch_only: u32,
    /// 仅 HEAD 可达（该分支缺少）的提交数。
    pub head_only: u32,
    /// 仅该分支可达的最近提交，最多 limit 条。
    pub branch_only_commits: Vec<CommitSummaryDto>,
    pub branch_only_truncated: bool,
    /// 仅 HEAD 可达的最近提交，最多 limit 条。
    pub head_only_commits: Vec<CommitSummaryDto>,
    pub head_only_truncated: bool,
}

/// 提交所属分支与相对当前分支的差异；全部基于本地分支（`refs/heads/*`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitBranchContextDto {
    pub generation: u64,
    pub oid: Oid,
    /// 当前 HEAD（detached 时为 HEAD 本身；unborn 时为 None）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_branch: Option<String>,
    /// 包含该提交的全部本地分支名（含当前分支）。
    pub branches: Vec<String>,
    /// 相对当前 HEAD 的差异；当前分支自身不列入。
    pub gaps: Vec<BranchGapDto>,
    /// 超过展示上限而未计算的本地分支数。
    pub gaps_omitted: u32,
}

/* ------------------------------ 搜索 ------------------------------ */

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchField {
    Message,
    Hash,
    Author,
    Path,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    /// 前端生成，用于取消。
    pub search_id: String,
    pub scope: GraphScope,
    pub text: String,
    pub highlight: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatchDto {
    pub commit: CommitSummaryDto,
    pub fields: Vec<SearchField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPageDto {
    pub generation: u64,
    pub search_id: String,
    pub results: Vec<SearchMatchDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub has_more: bool,
    pub canceled: bool,
}

/* ------------------------------ 写操作 ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteKind {
    CherryPick,
    Revert,
    SwitchBranch,
    SetBranchDescription,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRequest {
    pub kind: WriteKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateIssueDto {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateReportDto {
    pub ok: bool,
    pub issues: Vec<GateIssueDto>,
    /// 用于确认框展示的摘要。
    pub summary: String,
    pub is_merge_commit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteStatus {
    Succeeded,
    EmptyPick,
    Conflicted,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteOutcomeDto {
    pub status: WriteStatus,
    pub message: String,
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    pub conflict_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption: Option<InterruptionDto>,
    /// 操作后重新探测到的 generation；前端仅在仍匹配时刷新。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<Oid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStatusDto {
    pub dirty: bool,
    pub staged: u32,
    pub tracked: u32,
    pub untracked: u32,
    pub conflicted: u32,
    pub is_bare: bool,
    pub detached: bool,
}

/* ------------------------------ 分支与外部工具 ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchDescriptionDto {
    pub branch: String,
    pub description: String,
    /// linked worktree 中写入共享 local config，其他 worktree 可见。
    pub shared_across_worktrees: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalToolDto {
    pub id: String,
    pub name: String,
    pub executable: String,
    /// 参数模板，仅支持 `$LOCAL` / `$REMOTE`；解析为参数数组而非 shell 字符串。
    pub args_template: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalToolRequest {
    pub tool_id: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compare: Option<Oid>,
}

/* ------------------------------ 应用设置 ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub schema_version: u32,
    pub recent_repositories: Vec<String>,
    pub external_tools: Vec<ExternalToolDto>,
    pub watch_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<WindowGeometry>,
    pub recent_limit: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            recent_repositories: Vec::new(),
            external_tools: Vec::new(),
            watch_enabled: true,
            window: None,
            recent_limit: 10,
        }
    }
}
