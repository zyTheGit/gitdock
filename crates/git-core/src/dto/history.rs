//! 单文件历史与行级追溯（Blame）契约，见 ADR-0031。

use serde::{Deserialize, Serialize};

use crate::oid::Oid;

use super::diff::FileStatus;
use super::graph::CommitSummaryDto;

/* ------------------------------ 单文件提交历史 ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHistoryEntryDto {
    pub commit: CommitSummaryDto,
    /// 该提交相对第一父对该路径的改动类型。
    pub status: FileStatus,
    /// 首版不追踪重命名，恒为 None；保留字段供后续 follow 启发式使用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHistoryPageDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub path: String,
    pub entries: Vec<FileHistoryEntryDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

/* ------------------------------ 行级追溯 ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlameLineDto {
    /// 1 起的行号。
    pub line_no: u32,
    pub oid: Oid,
    pub short_oid: String,
    pub author_name: String,
    /// Unix 秒。
    pub authored_at: i64,
    /// 归属提交的首行摘要。
    pub summary: String,
    /// 行内容，不含行尾换行符。
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBlameDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub oid: Oid,
    pub path: String,
    pub lines: Vec<BlameLineDto>,
    pub binary: bool,
    pub too_large: bool,
    /// 内容不是合法 UTF-8，已按有损方式解码。
    pub encoding_fallback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}
