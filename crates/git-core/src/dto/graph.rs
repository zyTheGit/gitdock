use crate::oid::Oid;
use serde::{Deserialize, Serialize};

use super::repo::{RefKind, WarningDto};

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
    /// 本页数据对应的范围（结构化）；展示文案由前端按语言渲染，后端不拼句子。
    pub scope: GraphScope,
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
