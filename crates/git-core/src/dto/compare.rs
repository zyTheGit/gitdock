use crate::oid::Oid;
use serde::{Deserialize, Serialize};

use super::diff::ChangedFileDto;
use super::graph::{CommitSummaryDto, GraphScope};
use super::repo::WarningDto;

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
    /// 一侧是当前工作区（ADR-0030）：工作区没有提交历史，只能是两端快照语义。
    Worktree,
}

/// 对比中哪一侧是当前工作区（非提交对象）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorktreeSide {
    Base,
    Compare,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareResultDto {
    pub generation: u64,
    /// 该侧的提交 OID；工作区侧是没有提交对象的，此时填该工作区所在 HEAD
    /// （unborn 时回退为另一侧提交），前端应以 `worktree_side` 为准（ADR-0030）。
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
    /// 哪一侧是当前工作区；None 表示两侧都是提交。旧响应缺省为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_side: Option<WorktreeSide>,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchDateRange {
    /// Unix 秒，包含；None 表示不限制起点。
    pub from: Option<i64>,
    /// Unix 秒，不包含；None 表示不限制终点。
    pub to: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    /// 前端生成，用于取消。
    pub search_id: String,
    pub scope: GraphScope,
    pub text: String,
    pub highlight: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_range: Option<SearchDateRange>,
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
