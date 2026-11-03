use std::collections::HashSet;

use git_core::{
    decode_cursor, encode_cursor, ErrorCode, GraphPageDto, GraphScope, Oid, ResolvedEdgeDto,
    Result, RowLayoutDto, UserVisibleError, WarningDto,
};
use graph_layout::LayoutCommit;

use super::{
    commit_summary, read_head, read_refs, GitReadModule, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT,
};
use crate::index::GraphIndex;
use crate::util::oid_from_id;

fn stale_cursor() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::CursorStale, "仓库状态已变化，请刷新后重新加载")
}

impl GitReadModule {
    /// 读取一页图谱。`cursor` 为空表示从当前视图第一条开始。
    pub fn read_graph_page(
        &self,
        scope: &GraphScope,
        cursor: Option<&str>,
        limit: usize,
    ) -> Result<GraphPageDto> {
        let limit = limit.clamp(1, MAX_PAGE_LIMIT);
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let view_key = scope.view_key();
        let index = self.build_index(&repo, scope, &view_key, generation)?;
        let start = match cursor {
            Some(token) => {
                let data = decode_cursor(token)?;
                if data.generation != generation {
                    return Err(stale_cursor());
                }
                if data.view_key != view_key {
                    return Err(UserVisibleError::new(
                        ErrorCode::CursorInvalid,
                        "分页游标与当前视图不匹配，请刷新图谱",
                    ));
                }
                let after = Oid::new(data.after).map_err(|e| {
                    UserVisibleError::new(ErrorCode::CursorInvalid, "分页游标中的 OID 无效")
                        .with_detail(e.to_string())
                })?;
                index
                    .position(&after)
                    .map(|p| p + 1)
                    .ok_or_else(stale_cursor)?
            }
            None => 0,
        };
        self.render_page(&repo, &index, scope, generation, start, limit, cursor)
    }

    /// 定位到指定提交所在的页；用于搜索结果与外部定位。
    pub fn read_graph_page_around(
        &self,
        scope: &GraphScope,
        oid: &Oid,
        limit: usize,
    ) -> Result<GraphPageDto> {
        let limit = limit.clamp(1, MAX_PAGE_LIMIT);
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let view_key = scope.view_key();
        let index = self.build_index(&repo, scope, &view_key, generation)?;
        let position = index.position(oid).ok_or_else(|| {
            UserVisibleError::new(ErrorCode::Internal, "该提交不在当前图谱视图中")
        })?;
        let half = limit / 2;
        let start = position.saturating_sub(half);
        self.render_page(&repo, &index, scope, generation, start, limit, None)
    }

    #[allow(clippy::too_many_arguments)]
    fn render_page(
        &self,
        repo: &gix::Repository,
        index: &GraphIndex,
        scope: &GraphScope,
        generation: u64,
        start: usize,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<GraphPageDto> {
        let view_key = scope.view_key();
        let end = (start + limit).min(index.order.len());
        let mut warnings = self.warnings(repo);
        if index.order.is_empty() {
            warnings.push(WarningDto {
                code: "empty_repository".to_owned(),
                message: "该视图没有可显示的提交".to_owned(),
            });
        }
        let (rows, resolved) = self.ensure_layout(index, &view_key, generation, start, end);
        let (_, badges) = read_refs(repo, &read_head(repo)?)?;
        let mut commits = Vec::with_capacity(end.saturating_sub(start));
        for oid in index.order_slice(start, limit) {
            commits.push(commit_summary(repo, oid, &badges)?);
        }
        let has_more = end < index.order.len();
        let next_cursor = if has_more {
            index
                .order
                .get(end.saturating_sub(1))
                .map(|last| encode_cursor(&view_key, generation, last))
        } else {
            None
        };
        let anchor_oid = cursor
            .and_then(|token| decode_cursor(token).ok())
            .and_then(|data| Oid::new(data.after).ok());
        Ok(GraphPageDto {
            generation,
            view_key,
            scope: scope.clone(),
            commits,
            next_cursor,
            has_more,
            layout: rows,
            resolved_edges: resolved,
            anchor_oid,
            warnings,
        })
    }

    /// 构建（或复用）布局到 `end`，返回 [start, end) 的行与本次解决的边。
    fn ensure_layout(
        &self,
        index: &GraphIndex,
        view_key: &str,
        generation: u64,
        start: usize,
        end: usize,
    ) -> (Vec<RowLayoutDto>, Vec<ResolvedEdgeDto>) {
        let mut cache = self.layout.lock();
        if cache.view_key.as_deref() != Some(view_key) || cache.generation != generation {
            cache.layout.reset(view_key);
            cache.view_key = Some(view_key.to_owned());
            cache.generation = generation;
        }
        let cached = cache.layout.rows().len();
        let mut resolved = Vec::new();
        if cached < end {
            for chunk_start in (cached..end).step_by(DEFAULT_PAGE_LIMIT) {
                let chunk_end = (chunk_start + DEFAULT_PAGE_LIMIT).min(end);
                let commits: Vec<LayoutCommit> = index.order[chunk_start..chunk_end]
                    .iter()
                    .map(|oid| LayoutCommit {
                        oid: oid.clone(),
                        parents: index
                            .nodes
                            .get(oid)
                            .map(|node| {
                                node.parents
                                    .iter()
                                    .filter_map(|p| Oid::new(p.clone()).ok())
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                    .collect();
                let delta = cache.layout.append(&commits);
                resolved.extend(delta.resolved);
            }
        }
        let rows = cache.layout.rows().get(start..end).unwrap_or(&[]).to_vec();
        let resolved = resolved
            .into_iter()
            .filter(|edge| edge.row < end)
            .map(|edge| ResolvedEdgeDto {
                row: edge.row,
                parent: edge.parent,
                lane: edge.lane,
            })
            .collect();
        (rows, resolved)
    }
}

pub(super) fn scope_tips(repo: &gix::Repository, scope: &GraphScope) -> Result<Vec<Oid>> {
    match scope {
        GraphScope::Head => match repo.head_id() {
            Ok(id) => Ok(vec![oid_from_id(&id)]),
            Err(_) => Ok(Vec::new()),
        },
        GraphScope::All => {
            let (refs, _) = read_refs(repo, &read_head(repo)?)?;
            let mut seen = HashSet::new();
            let mut tips = Vec::new();
            for reference in refs {
                if let Some(oid) = reference.commit_oid {
                    if seen.insert(oid.clone()) {
                        tips.push(oid);
                    }
                }
            }
            Ok(tips)
        }
        GraphScope::Branch(name) => {
            let candidates = [
                format!("refs/heads/{name}"),
                format!("refs/remotes/{name}"),
                format!("refs/tags/{name}"),
            ];
            for candidate in candidates {
                if let Ok(mut reference) = repo.find_reference(&candidate) {
                    if let Ok(id) = reference.peel_to_id() {
                        return Ok(vec![oid_from_id(&id)]);
                    }
                }
            }
            Err(UserVisibleError::new(
                ErrorCode::RefNotFound,
                format!("找不到引用 {name}"),
            ))
        }
    }
}
