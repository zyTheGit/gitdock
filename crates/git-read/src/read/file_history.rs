//! 单文件提交历史：沿拓扑索引比较目标路径的条目 OID，只发出真正改动过该路径的提交。
//!
//! 规则与边界见 ADR-0031：与第一父比较（merge 只按第一父视角），首版不追踪重命名，
//! cursor 复用 `git-core::cursor`（内部只记录最后处理过的提交 OID）。

use git_core::{
    decode_cursor, encode_cursor, ErrorCode, FileHistoryEntryDto, FileHistoryPageDto, FileStatus,
    GraphScope, Oid, Result, UserVisibleError,
};

use super::{
    commit_summary, tree_oid_of_commit, tree_oid_of_object, GitReadModule, MAX_PAGE_LIMIT,
};
use crate::diff::lookup_path;
use crate::index::{self, GraphIndex};
use crate::util::{find_commit, normalize_repo_path, oid_from_id};

/// 单次请求最多扫描的提交数：文件长期未改时避免一次扫穿全库。
const MAX_SCAN: usize = 20_000;

impl GitReadModule {
    /// 读取一页单文件历史。`oid_or_scope` 解析规则见 ADR-0031 §2.4。
    pub fn read_file_history(
        &self,
        path: &str,
        oid_or_scope: Option<&str>,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<FileHistoryPageDto> {
        let limit = limit.clamp(1, MAX_PAGE_LIMIT);
        let path = normalize_repo_path(path)?;
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let (view_key, index) = self.history_index(&repo, oid_or_scope, generation)?;
        let start = start_from_cursor(&index, &view_key, generation, cursor)?;

        let mut entries: Vec<FileHistoryEntryDto> = Vec::new();
        let mut processed: Option<Oid> = None;
        let end_of_scan = (start + MAX_SCAN).min(index.order.len());
        let snapshot = self.refs_snapshot(&repo, generation)?;
        for oid in &index.order[start..end_of_scan] {
            if entries.len() >= limit {
                break;
            }
            processed = Some(oid.clone());
            if let Some(status) = self.path_status(&repo, oid, &path)? {
                entries.push(FileHistoryEntryDto {
                    commit: commit_summary(&repo, oid, &snapshot.badges)?,
                    status,
                    old_path: None,
                });
            }
        }

        let last_position = processed.as_ref().and_then(|oid| index.position(oid));
        let has_more = match last_position {
            Some(position) => position + 1 < index.order.len(),
            None => start < index.order.len(),
        };
        let next_cursor = if has_more {
            processed.map(|oid| encode_cursor(&view_key, generation, &oid))
        } else {
            None
        };
        Ok(FileHistoryPageDto {
            generation,
            path,
            entries,
            next_cursor,
            has_more,
        })
    }

    /// 按起点参数构建（或复用）拓扑索引，返回视图键与索引。
    fn history_index(
        &self,
        repo: &gix::Repository,
        oid_or_scope: Option<&str>,
        generation: u64,
    ) -> Result<(String, GraphIndex)> {
        match parse_scope(oid_or_scope)? {
            FileHistoryScope::Graph(scope) => {
                let view_key = scope.view_key();
                let index = self.build_index(repo, &scope, &view_key, generation)?;
                Ok((view_key, index))
            }
            FileHistoryScope::Commit(oid) => {
                let view_key = format!("commit:{oid}");
                let index = index::build(
                    repo,
                    std::slice::from_ref(&oid),
                    &view_key,
                    generation,
                    self.cache_dir.as_deref(),
                )?;
                Ok((view_key, index))
            }
        }
    }

    /// 该提交相对第一父对 `path` 的改动类型；未改动返回 None。
    fn path_status(
        &self,
        repo: &gix::Repository,
        oid: &Oid,
        path: &str,
    ) -> Result<Option<FileStatus>> {
        let commit = find_commit(repo, oid)?;
        let new_tree = tree_oid_of_object(&commit)?;
        let new_entry = lookup_path(repo, &new_tree, path)?;
        let old_entry = match commit.parent_ids().next() {
            Some(parent) => {
                let parent_tree = tree_oid_of_commit(repo, &oid_from_id(&parent))?;
                lookup_path(repo, &parent_tree, path)?
            }
            None => None,
        };
        Ok(match (old_entry, new_entry) {
            (None, None) => None,
            (None, Some(_)) => Some(FileStatus::Added),
            (Some(_), None) => Some(FileStatus::Deleted),
            (Some((old_mode, old_oid)), Some((new_mode, new_oid))) => {
                if old_oid != new_oid {
                    Some(FileStatus::Modified)
                } else if old_mode != new_mode {
                    Some(FileStatus::TypeChanged)
                } else {
                    None
                }
            }
        })
    }
}

/// 起点参数：图谱视图或显式提交。
enum FileHistoryScope {
    Graph(GraphScope),
    Commit(Oid),
}

/// 解析 `head` / `all` / 分支名 / 完整 OID；空值等价 head。
fn parse_scope(oid_or_scope: Option<&str>) -> Result<FileHistoryScope> {
    let Some(value) = oid_or_scope.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(FileHistoryScope::Graph(GraphScope::Head));
    };
    match value {
        "head" => Ok(FileHistoryScope::Graph(GraphScope::Head)),
        "all" => Ok(FileHistoryScope::Graph(GraphScope::All)),
        other => match Oid::new(other) {
            Ok(oid) => Ok(FileHistoryScope::Commit(oid)),
            Err(_) => Ok(FileHistoryScope::Graph(GraphScope::Branch(
                other.to_owned(),
            ))),
        },
    }
}

fn stale_cursor() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::CursorStale, "仓库状态已变化，请刷新后重新加载")
        .with_key("errors.fileHistoryCursorStale")
}

/// 校验 cursor 并换算成索引起点（游标指向最后处理过的提交之后）。
fn start_from_cursor(
    index: &GraphIndex,
    view_key: &str,
    generation: u64,
    cursor: Option<&str>,
) -> Result<usize> {
    let Some(token) = cursor else {
        return Ok(0);
    };
    let data = decode_cursor(token)?;
    if data.generation != generation {
        return Err(stale_cursor());
    }
    if data.view_key != view_key {
        return Err(UserVisibleError::new(
            ErrorCode::CursorInvalid,
            "分页游标与当前文件历史不匹配，请重新加载",
        )
        .with_key("errors.fileHistoryCursorViewMismatch"));
    }
    let after = Oid::new(data.after).map_err(|e| {
        UserVisibleError::new(ErrorCode::CursorInvalid, "分页游标中的 OID 无效")
            .with_key("errors.fileHistoryCursorOidInvalid")
            .with_detail(e.to_string())
    })?;
    index
        .position(&after)
        .map(|position| position + 1)
        .ok_or_else(stale_cursor)
}
