//! stash 详情契约（ADR-0030）：只读预览一条 stash 的文件清单。

use crate::oid::Oid;
use serde::{Deserialize, Serialize};

use super::diff::ChangedFileDto;
use super::repo::WarningDto;

/// 单条 stash 的文件清单：合并 tracked 改动（工作区树对第 1 父）与
/// `stash -u` 的未跟踪文件（第 3 父树）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashDetailDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    /// stash 提交 OID；与 `StashEntryDto.oid` 一致。
    pub oid: Oid,
    pub files: Vec<ChangedFileDto>,
    /// 文件数超过服务端上限，`files` 已被截断。
    pub truncated: bool,
    /// 该 stash 是否包含未跟踪文件（`git stash -u`，存在第 3 父提交）。
    pub includes_untracked: bool,
    pub warnings: Vec<WarningDto>,
}
