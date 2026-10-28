//! GitReadModule：仓库状态、分页图谱、commit 详情与对比。
//!
//! 只读路径完全基于 gix；cursor 为不透明 continuation token，内部只记录最后一条 OID。
//! 每次返回都携带 generation，前端据此丢弃过期响应。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use git_core::{
    encode_cursor, decode_cursor, ChangedFileDto, CommitDetailDto, CommitSummaryDto,
    CompareMode, CompareResultDto, DiffBaselineDto, ErrorCode, FileDiffDto, GraphPageDto,
    GraphScope, HeadDto, HeadKind, InterruptionDto, InterruptionKind, ObjectFormat, Oid,
    RefBadgeDto, RefDto, RefKind, RepoStateDto, ResolvedEdgeDto, Result, RowLayoutDto,
    UserVisibleError, WarningDto,
};
use graph_layout::{GraphLayoutModule, LayoutCommit};
use parking_lot::Mutex;
use sha2::{Digest, Sha256};

use crate::diff::{collect_changes, diff_file};
use crate::index::{self, GraphIndex};
use crate::util::{
    find_commit, gix_oid, lossy, oid_from_gix, oid_from_id, raw_time_seconds,
};

pub const DEFAULT_PAGE_LIMIT: usize = 200;
pub const MAX_PAGE_LIMIT: usize = 500;
pub const MINIMUM_GIT_VERSION: &str = "2.30.0";

const INTERRUPTION_MARKERS: &[(&str, InterruptionKind)] = &[
    ("MERGE_HEAD", InterruptionKind::Merge),
    ("CHERRY_PICK_HEAD", InterruptionKind::CherryPick),
    ("REVERT_HEAD", InterruptionKind::Revert),
    ("REBASE_HEAD", InterruptionKind::Rebase),
    ("rebase-merge", InterruptionKind::Rebase),
    ("rebase-apply", InterruptionKind::Rebase),
    ("sequencer", InterruptionKind::Sequencer),
    ("index.lock", InterruptionKind::IndexLock),
];

pub struct GitReadModule {
    pub(crate) path: PathBuf,
    pub(crate) repo_root: PathBuf,
    pub(crate) git_dir: PathBuf,
    pub(crate) common_dir: PathBuf,
    pub(crate) object_format: ObjectFormat,
    pub(crate) cache_dir: Option<PathBuf>,
    pub(crate) git_version: Option<String>,
    pub(crate) git_version_supported: bool,
    pub(crate) layout: Mutex<LayoutCache>,
    pub(crate) searches: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

/// 外部 diff 工具需要的两侧文件内容；缺失一侧为空字节。
pub struct FileSides {
    pub old: Vec<u8>,
    pub new: Vec<u8>,
}

#[derive(Default)]
pub(crate) struct LayoutCache {
    pub(crate) view_key: Option<String>,
    pub(crate) generation: u64,
    pub(crate) layout: GraphLayoutModule,
}

impl GitReadModule {
    /// 打开仓库（工作区、bare 或 linked worktree）。
    pub fn open(path: &Path, cache_dir: Option<PathBuf>) -> Result<Self> {
        let repo = gix::discover(path).map_err(|e| {
            UserVisibleError::new(ErrorCode::NotARepository, "无法打开 Git 仓库")
                .with_detail(e.to_string())
        })?;
        let object_format = match repo.object_hash() {
            gix::hash::Kind::Sha1 => ObjectFormat::Sha1,
            gix::hash::Kind::Sha256 => ObjectFormat::Sha256,
            // Kind 为 non_exhaustive：出现未知哈希类型时不做猜测，直接拒绝。
            other => {
                return Err(UserVisibleError::new(
                    ErrorCode::UnsupportedObjectFormat,
                    "仓库使用了暂不支持的哈希算法",
                )
                .with_detail(format!("object hash: {other:?}")));
            }
        };
        let git_dir = repo.git_dir().to_path_buf();
        let common_dir = repo.common_dir().to_path_buf();
        let repo_root = repo
            .workdir()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| git_dir.clone());
        let (git_version, git_version_supported) = detect_git_version();
        Ok(Self {
            path: path.to_path_buf(),
            repo_root,
            git_dir,
            common_dir,
            object_format,
            cache_dir,
            git_version,
            git_version_supported,
            layout: Mutex::new(LayoutCache::default()),
            searches: Mutex::new(HashMap::new()),
        })
    }

    pub fn path(&self) -> &Path {
        &self.repo_root
    }

    pub fn object_format(&self) -> ObjectFormat {
        self.object_format
    }

    pub(crate) fn repo(&self) -> Result<gix::Repository> {
        gix::open(&self.path).map_err(|e| {
            UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库已不可用")
                .with_detail(e.to_string())
        })
    }

    /// 读取仓库状态：HEAD、refs、对象格式、中断态与提示。
    pub fn state(&self) -> Result<RepoStateDto> {
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let head = read_head(&repo)?;
        let (refs, _) = read_refs(&repo, &head)?;
        let warnings = self.warnings(&repo);
        Ok(RepoStateDto {
            path: self.repo_root.to_string_lossy().into_owned(),
            object_format: self.object_format,
            head,
            refs,
            generation,
            is_bare: repo.is_bare(),
            is_linked_worktree: self.git_dir != self.common_dir,
            is_shallow: self.git_dir.join("shallow").exists(),
            interruption: detect_interruption(&self.git_dir),
            git_version: self.git_version.clone(),
            git_version_supported: self.git_version_supported,
            minimum_git_version: MINIMUM_GIT_VERSION.to_owned(),
            warnings,
        })
    }

    /// 当前仓库的 generation 指纹。refs、HEAD、对象格式或中断态变化都会递增语义。
    pub fn current_generation(&self) -> Result<u64> {
        let repo = self.repo()?;
        self.fingerprint(&repo)
    }

    pub(crate) fn fingerprint(&self, repo: &gix::Repository) -> Result<u64> {
        let mut parts: Vec<String> = Vec::new();
        parts.push(format!(
            "path:{}",
            self.repo_root.to_string_lossy()
        ));
        parts.push(format!("format:{}", self.object_format.as_str()));
        let head = repo.head().map_err(gix_error)?;
        if head.is_unborn() {
            parts.push("head:unborn".to_owned());
        } else if let Some(name) = head.referent_name() {
            parts.push(format!("head:{}", lossy(name.as_bstr())));
        } else {
            parts.push("head:detached".to_owned());
        }
        if let Ok(id) = repo.head_id() {
            parts.push(format!("head_oid:{}", id.detach()));
        }
        for reference in repo.references().map_err(gix_error)?.all().map_err(gix_error)? {
            let reference = reference.map_err(gix_error)?;
            let name = lossy(reference.name().as_bstr());
            let target = match reference.target() {
                gix::refs::TargetRef::Object(id) => id.to_string(),
                gix::refs::TargetRef::Symbolic(name) => lossy(name.as_bstr()),
            };
            parts.push(format!("ref:{name}={target}"));
        }
        parts.sort();
        for (marker, _) in INTERRUPTION_MARKERS {
            if self.git_dir.join(marker).exists() {
                parts.push(format!("marker:{marker}"));
            }
        }
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update(part.as_bytes());
            hasher.update(b"\n");
        }
        let digest = hasher.finalize();
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&digest[..8]);
        Ok(u64::from_le_bytes(bytes))
    }

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
                index.position(&after).map(|p| p + 1).ok_or_else(stale_cursor)?
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
        let anchor_oid = cursor.and_then(|token| decode_cursor(token).ok()).and_then(|data| {
            Oid::new(data.after).ok()
        });
        Ok(GraphPageDto {
            generation,
            view_key,
            view_label: scope.describe(),
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
        let rows = cache
            .layout
            .rows()
            .get(start..end)
            .unwrap_or(&[])
            .to_vec();
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

    pub(crate) fn build_index(
        &self,
        repo: &gix::Repository,
        scope: &GraphScope,
        view_key: &str,
        generation: u64,
    ) -> Result<GraphIndex> {
        let tips = self.scope_tips(repo, scope)?;
        index::build(
            repo,
            &tips,
            view_key,
            generation,
            self.cache_dir.as_deref(),
        )
    }

    fn scope_tips(&self, repo: &gix::Repository, scope: &GraphScope) -> Result<Vec<Oid>> {
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

    /// commit 详情：首父/空树基线与文件列表。
    pub fn read_commit(&self, oid: &Oid) -> Result<CommitDetailDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let (baseline, baseline_note) = match parents.len() {
            0 => (DiffBaselineDto::Root, "根提交：与空树比较".to_owned()),
            1 => (
                DiffBaselineDto::FirstParent,
                "与第一父提交比较".to_owned(),
            ),
            _ => (
                DiffBaselineDto::MergeFirstParent,
                "合并提交：与第一父提交比较，不展开合并引入的其他分支差异".to_owned(),
            ),
        };
        let old_tree = match parents.first() {
            Some(parent) => Some(tree_oid_of_commit(&repo, parent)?),
            None => None,
        };
        let new_tree = Some(tree_oid_of_object(&commit)?);
        let changes = collect_changes(&repo, old_tree.as_ref(), new_tree.as_ref(), None)?;
        let files: Vec<ChangedFileDto> = changes.files.iter().map(|c| c.to_dto()).collect();
        let mut warnings = Vec::new();
        if changes.truncated {
            warnings.push(WarningDto {
                code: "diff_truncated".to_owned(),
                message: format!("变更文件过多，仅显示前 {} 个文件", files.len()),
            });
        }
        let (_, badges) = read_refs(&repo, &read_head(&repo)?)?;
        let message = lossy(commit.message_raw().map_err(gix_error)?.as_ref());
        let summary = commit_summary(&repo, oid, &badges)?;
        Ok(CommitDetailDto {
            generation: self.current_generation()?,
            commit: summary,
            message,
            parents,
            files,
            baseline,
            baseline_note,
            warnings,
        })
    }

    /// 单文件 diff：二进制、超大文件、gitlink 与编码问题均结构化降级。
    pub fn read_file_diff(&self, oid: &Oid, path: &str) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let old_tree = match parents.first() {
            Some(parent) => Some(tree_oid_of_commit(&repo, parent)?),
            None => None,
        };
        let new_tree = Some(tree_oid_of_object(&commit)?);
        let mut dto = diff_file(&repo, old_tree.as_ref(), new_tree.as_ref(), path)?;
        dto.generation = self.current_generation()?;
        Ok(dto)
    }

    /// 三点对比；无 merge-base 时降级为两端快照 diff。
    pub fn compare(
        &self,
        base: &Oid,
        compare: &Oid,
        path_filter: Option<&str>,
    ) -> Result<CompareResultDto> {
        let repo = self.repo()?;
        let base_id = gix_oid(base)?;
        let compare_id = gix_oid(compare)?;
        let merge_base_id = repo.merge_base(base_id, compare_id).map_err(gix_error)?;
        let merge_base = merge_base_id.as_ref().map(oid_from_id);
        let (old_tree, mode) = match &merge_base {
            Some(mb) => (Some(tree_oid_of_commit(&repo, mb)?), CompareMode::ThreeDot),
            None => (
                Some(tree_oid_of_commit(&repo, base)?),
                CompareMode::TwoDotFallback,
            ),
        };
        let new_tree = Some(tree_oid_of_commit(&repo, compare)?);
        let changes = collect_changes(&repo, old_tree.as_ref(), new_tree.as_ref(), path_filter)?;
        let files: Vec<ChangedFileDto> = changes.files.iter().map(|c| c.to_dto()).collect();

        let base_set = reachable_set(&repo, base)?;
        let compare_set = reachable_set(&repo, compare)?;
        let base_only = base_set.difference(&compare_set).count() as u32;
        let compare_only = compare_set.difference(&base_set).count() as u32;

        let refs_for_badges = read_refs(&repo, &read_head(&repo)?)?.1;
        let stop: HashSet<Oid> = match &merge_base {
            Some(mb) => reachable_set(&repo, mb)?,
            None => HashSet::new(),
        };
        let mut commits = Vec::new();
        let mut commits_truncated = false;
        let walk = repo
            .rev_walk([compare_id])
            .sorting(gix::revision::walk::Sorting::ByCommitTime(
                gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
            ))
            .all()
            .map_err(gix_error)?;
        for info in walk {
            let info = info.map_err(gix_error)?;
            let oid = oid_from_gix(&info.id);
            if stop.contains(&oid) {
                continue;
            }
            if commits.len() >= DEFAULT_PAGE_LIMIT {
                commits_truncated = true;
                break;
            }
            commits.push(commit_summary(&repo, &oid, &refs_for_badges)?);
        }

        let mut warnings = Vec::new();
        if merge_base.is_none() {
            warnings.push(WarningDto {
                code: "no_merge_base".to_owned(),
                message: "两个引用没有共同祖先，已降级为两端快照对比".to_owned(),
            });
        }
        if changes.truncated {
            warnings.push(WarningDto {
                code: "diff_truncated".to_owned(),
                message: "变更文件过多，文件列表已截断".to_owned(),
            });
        }
        Ok(CompareResultDto {
            generation: self.current_generation()?,
            base: base.clone(),
            compare: compare.clone(),
            merge_base,
            mode,
            base_only,
            compare_only,
            files,
            commits,
            commits_truncated,
            title: format!("{} → {}", base.short(7), compare.short(7)),
            warnings,
        })
    }

    /// 对比中的单文件 diff，基线与 compare 一致。
    pub fn compare_file_diff(
        &self,
        base: &Oid,
        compare: &Oid,
        path: &str,
    ) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        let merge_base = repo
            .merge_base(gix_oid(base)?, gix_oid(compare)?)
            .map_err(gix_error)?;
        let old_tree = match merge_base.as_ref() {
            Some(mb) => Some(tree_oid_of_commit(&repo, &oid_from_id(mb))?),
            None => Some(tree_oid_of_commit(&repo, base)?),
        };
        let new_tree = Some(tree_oid_of_commit(&repo, compare)?);
        let mut dto = diff_file(&repo, old_tree.as_ref(), new_tree.as_ref(), path)?;
        dto.generation = self.current_generation()?;
        Ok(dto)
    }

    /// 读取对比两侧文件字节；三点模式下左侧固定为 merge-base（无则退回 Base）。
    pub fn file_sides(
        &self,
        left: Option<&Oid>,
        right: &Oid,
        path: &str,
        three_dot: bool,
    ) -> Result<FileSides> {
        if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "文件路径无效",
            ));
        }
        let repo = self.repo()?;
        let right_commit = find_commit(&repo, right)?;
        let new_tree = Some(tree_oid_of_object(&right_commit)?);
        let old_commit = match left {
            Some(left) => {
                if three_dot {
                    repo.merge_base(gix_oid(left)?, gix_oid(right)?)
                        .map_err(gix_error)?
                        .map(|id| oid_from_id(&id))
                } else {
                    Some(left.clone())
                }
            }
            None => None,
        };
        let old_tree = match old_commit {
            Some(commit) => Some(tree_oid_of_commit(&repo, &commit)?),
            None => None,
        };
        let (old, new) =
            crate::diff::file_bytes(&repo, old_tree.as_ref(), new_tree.as_ref(), path)?;
        if old.is_none() && new.is_none() {
            return Err(UserVisibleError::new(
                ErrorCode::FileNotFound,
                format!("提交中没有文件 {path}"),
            ));
        }
        Ok(FileSides {
            old: old.unwrap_or_default(),
            new: new.unwrap_or_default(),
        })
    }

    fn warnings(&self, repo: &gix::Repository) -> Vec<WarningDto> {
        let mut warnings = Vec::new();
        if self.object_format == ObjectFormat::Sha256 {
            warnings.push(WarningDto {
                code: "sha256_repository".to_owned(),
                message: "该仓库使用 SHA-256 对象格式；请确认所有 Git 工具版本支持".to_owned(),
            });
        }
        if self.git_dir.join("shallow").exists() {
            warnings.push(WarningDto {
                code: "shallow_repository".to_owned(),
                message: "浅克隆仓库：仅显示已经取回的提交历史".to_owned(),
            });
        }
        if self.git_version.is_none() {
            warnings.push(WarningDto {
                code: "git_missing".to_owned(),
                message: "未检测到系统 Git，写操作不可用；只读功能不受影响".to_owned(),
            });
        } else if !self.git_version_supported {
            warnings.push(WarningDto {
                code: "git_version_too_old".to_owned(),
                message: format!(
                    "系统 Git 版本低于 {}，写操作已禁用，请升级 Git",
                    MINIMUM_GIT_VERSION
                ),
            });
        }
        if repo.is_bare() {
            warnings.push(WarningDto {
                code: "bare_repository".to_owned(),
                message: "裸仓库：工作区相关写操作不可用".to_owned(),
            });
        }
        warnings
    }
}

fn stale_cursor() -> UserVisibleError {
    UserVisibleError::new(
        ErrorCode::CursorStale,
        "仓库状态已变化，请刷新后重新加载",
    )
}

fn gix_error(err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "读取 Git 数据失败").with_detail(err.to_string())
}

pub(crate) fn read_head(repo: &gix::Repository) -> Result<HeadDto> {
    let head = repo.head().map_err(gix_error)?;
    let branch = head
        .referent_name()
        .map(|name| strip_local_branch_prefix(&lossy(name.as_bstr())));
    let oid = repo.head_id().ok().map(|id| oid_from_id(&id));
    let kind = if head.is_unborn() {
        HeadKind::Unborn
    } else if head.is_detached() {
        HeadKind::Detached
    } else {
        HeadKind::Branch
    };
    Ok(HeadDto { kind, branch, oid })
}

pub(crate) type RefBadges = HashMap<Oid, Vec<RefBadgeDto>>;

pub(crate) fn read_refs(
    repo: &gix::Repository,
    head: &HeadDto,
) -> Result<(Vec<RefDto>, RefBadges)> {
    let head_ref = head
        .branch
        .as_ref()
        .map(|branch| format!("refs/heads/{branch}"));
    let descriptions = local_branch_descriptions(repo);
    let mut refs = Vec::new();
    for reference in repo.references().map_err(gix_error)?.all().map_err(gix_error)? {
        let mut reference = reference.map_err(gix_error)?;
        let full_name = lossy(reference.name().as_bstr());
        let (kind, short_name) = classify_ref(&full_name);
        let Some(kind) = kind else { continue };
        let target_oid = match reference.target() {
            gix::refs::TargetRef::Object(id) => oid_from_gix(id),
            gix::refs::TargetRef::Symbolic(_) => continue,
        };
        let commit_oid = reference
            .peel_to_id()
            .ok()
            .map(|id| oid_from_id(&id));
        let description = if kind == RefKind::LocalBranch {
            descriptions.get(&short_name).cloned()
        } else {
            None
        };
        refs.push(RefDto {
            is_head: head_ref.as_deref() == Some(full_name.as_str()),
            full_name,
            short_name,
            kind,
            target_oid,
            commit_oid,
            description,
        });
    }
    refs.sort_by(|a, b| {
        ref_rank(a.kind)
            .cmp(&ref_rank(b.kind))
            .then_with(|| a.short_name.cmp(&b.short_name))
    });
    let mut badges: RefBadges = HashMap::new();
    for reference in &refs {
        if let Some(commit) = &reference.commit_oid {
            badges.entry(commit.clone()).or_default().push(RefBadgeDto {
                name: reference.short_name.clone(),
                kind: reference.kind,
                is_head: reference.is_head,
                description: reference.description.clone(),
            });
        }
    }
    Ok((refs, badges))
}

/// 读取 local config 中的 branch.<name>.description；空值按“未设置”处理。
fn local_branch_descriptions(repo: &gix::Repository) -> HashMap<String, String> {
    let snapshot = repo.config_snapshot();
    let Some(sections) = snapshot.plumbing().sections_by_name("branch") else {
        return HashMap::new();
    };
    sections
        .filter_map(|section| {
            let name = section.header().subsection_name()?;
            let value = section.value("description")?;
            let text = lossy(value.as_ref());
            if text.trim().is_empty() {
                return None;
            }
            Some((lossy(AsRef::<[u8]>::as_ref(name)), text))
        })
        .collect()
}

fn classify_ref(full_name: &str) -> (Option<RefKind>, String) {
    if let Some(name) = full_name.strip_prefix("refs/heads/") {
        (Some(RefKind::LocalBranch), name.to_owned())
    } else if let Some(name) = full_name.strip_prefix("refs/remotes/") {
        (Some(RefKind::RemoteBranch), name.to_owned())
    } else if let Some(name) = full_name.strip_prefix("refs/tags/") {
        (Some(RefKind::Tag), name.to_owned())
    } else if full_name == "HEAD" {
        (Some(RefKind::Head), "HEAD".to_owned())
    } else {
        (None, full_name.to_owned())
    }
}

fn ref_rank(kind: RefKind) -> u8 {
    match kind {
        RefKind::Head => 0,
        RefKind::LocalBranch => 1,
        RefKind::RemoteBranch => 2,
        RefKind::Tag => 3,
        RefKind::Other => 4,
    }
}

fn strip_local_branch_prefix(full_name: &str) -> String {
    full_name
        .strip_prefix("refs/heads/")
        .unwrap_or(full_name)
        .to_owned()
}

pub(crate) fn commit_summary(
    repo: &gix::Repository,
    oid: &Oid,
    badges: &RefBadges,
) -> Result<CommitSummaryDto> {
    let commit = find_commit(repo, oid)?;
    let author = commit.author().map_err(gix_error)?;
    let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
    let message = lossy(commit.message_raw().map_err(gix_error)?.as_ref());
    let summary = message
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(200)
        .collect::<String>();
    Ok(CommitSummaryDto {
        oid: oid.clone(),
        short_oid: oid.short(7).to_owned(),
        parents,
        summary,
        author_name: lossy(author.name),
        author_email: lossy(author.email),
        authored_at: raw_time_seconds(author.time),
        committed_at: commit.time().map(|t| t.seconds).unwrap_or(0),
        refs: badges.get(oid).cloned().unwrap_or_default(),
    })
}

pub(crate) fn tree_oid_of_commit(repo: &gix::Repository, oid: &Oid) -> Result<Oid> {
    let commit = find_commit(repo, oid)?;
    tree_oid_of_object(&commit)
}

fn tree_oid_of_object(commit: &gix::Commit<'_>) -> Result<Oid> {
    let id = commit.tree_id().map_err(gix_error)?;
    Ok(oid_from_id(&id))
}

fn reachable_set(repo: &gix::Repository, oid: &Oid) -> Result<HashSet<Oid>> {
    let mut set = HashSet::new();
    let walk = repo
        .rev_walk([gix_oid(oid)?])
        .sorting(gix::revision::walk::Sorting::BreadthFirst)
        .all()
        .map_err(gix_error)?;
    for info in walk {
        let info = info.map_err(gix_error)?;
        set.insert(oid_from_gix(&info.id));
    }
    Ok(set)
}

fn detect_interruption(git_dir: &Path) -> InterruptionDto {
    let mut kinds = Vec::new();
    for (marker, kind) in INTERRUPTION_MARKERS {
        if git_dir.join(marker).exists() && !kinds.contains(kind) {
            kinds.push(*kind);
        }
    }
    if kinds.is_empty() {
        return InterruptionDto::none();
    }
    let labels: Vec<&str> = kinds
        .iter()
        .map(|kind| match kind {
            InterruptionKind::Merge => "合并",
            InterruptionKind::CherryPick => "cherry-pick",
            InterruptionKind::Revert => "revert",
            InterruptionKind::Rebase => "rebase",
            InterruptionKind::Sequencer => "序列操作",
            InterruptionKind::IndexLock => "index 锁",
        })
        .collect();
    InterruptionDto {
        kinds,
        files: Vec::new(),
        message: format!("仓库存在未完成的{}操作", labels.join("、")),
        terminal_hint: "请在终端中检查并完成或中止该操作；本应用不会自动执行 abort/quit".to_owned(),
    }
}

/// 探测系统 Git 版本与最低版本支持情况；供应用外壳展示能力。
pub fn detect_git_version() -> (Option<String>, bool) {
    let output = std::process::Command::new("git")
        .arg("--version")
        .output();
    let Ok(output) = output else {
        return (None, false);
    };
    if !output.status.success() {
        return (None, false);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text
        .trim()
        .strip_prefix("git version ")
        .unwrap_or(text.trim())
        .to_owned();
    let supported = version_at_least(&version, MINIMUM_GIT_VERSION);
    (Some(version), supported)
}

fn version_at_least(actual: &str, minimum: &str) -> bool {
    fn parts(value: &str) -> Vec<u64> {
        value
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    }
    let actual = parts(actual);
    let minimum = parts(minimum);
    for index in 0..3 {
        let a = actual.get(index).copied().unwrap_or(0);
        let m = minimum.get(index).copied().unwrap_or(0);
        if a != m {
            return a > m;
        }
    }
    true
}
