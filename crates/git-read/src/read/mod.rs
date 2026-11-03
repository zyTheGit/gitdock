//! GitReadModule：仓库状态、分页图谱、commit 详情与对比。
//!
//! 只读路径完全基于 gix；cursor 为不透明 continuation token，内部只记录最后一条 OID。
//! 每次返回都携带 generation，前端据此丢弃过期响应。

mod compare;
mod detail;
mod graph;
mod probe;
mod refs;

use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use git_core::{
    interruption_dto, ErrorCode, ObjectFormat, Oid, RepoStateDto, Result, UserVisibleError,
    WarningDto, MARKERS,
};
use graph_layout::GraphLayoutModule;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};

use crate::index;
use crate::util::{find_commit, gix_oid, lossy, oid_from_gix, oid_from_id};

pub use probe::detect_git_version;

pub(crate) use refs::{commit_summary, read_head, read_refs, RefBadges};

pub const DEFAULT_PAGE_LIMIT: usize = 200;
pub const MAX_PAGE_LIMIT: usize = 500;
pub const MINIMUM_GIT_VERSION: &str = "2.30.0";

pub struct GitReadModule {
    /// 打开时传入的原始路径，供 gix 重新打开仓库使用。
    pub(crate) requested_path: PathBuf,
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
            requested_path: path.to_path_buf(),
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

    /// 工作区根目录；bare 仓库没有工作区时回退到 git 目录。
    pub fn path(&self) -> &Path {
        &self.repo_root
    }

    pub fn object_format(&self) -> ObjectFormat {
        self.object_format
    }

    pub(crate) fn repo(&self) -> Result<gix::Repository> {
        gix::open(&self.requested_path).map_err(|e| {
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
            interruption: interruption_dto(&self.git_dir, Vec::new()),
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
        parts.push(format!("path:{}", self.repo_root.to_string_lossy()));
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
        for reference in repo
            .references()
            .map_err(gix_error)?
            .all()
            .map_err(gix_error)?
        {
            let reference = reference.map_err(gix_error)?;
            let name = lossy(reference.name().as_bstr());
            let target = match reference.target() {
                gix::refs::TargetRef::Object(id) => id.to_string(),
                gix::refs::TargetRef::Symbolic(name) => lossy(name.as_bstr()),
            };
            parts.push(format!("ref:{name}={target}"));
        }
        parts.sort();
        for (marker, _) in MARKERS {
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

    pub(crate) fn build_index(
        &self,
        repo: &gix::Repository,
        scope: &git_core::GraphScope,
        view_key: &str,
        generation: u64,
    ) -> Result<crate::index::GraphIndex> {
        let tips = graph::scope_tips(repo, scope)?;
        index::build(repo, &tips, view_key, generation, self.cache_dir.as_deref())
    }

    fn warnings(&self, repo: &gix::Repository) -> Vec<WarningDto> {
        let mut warnings = Vec::new();
        if self.object_format == ObjectFormat::Sha256 {
            warnings.push(WarningDto::new(
                "sha256_repository",
                "该仓库使用 SHA-256 对象格式；请确认所有 Git 工具版本支持",
            ));
        }
        if self.git_dir.join("shallow").exists() {
            warnings.push(WarningDto::new(
                "shallow_repository",
                "浅克隆仓库：仅显示已经取回的提交历史",
            ));
        }
        if self.git_version.is_none() {
            warnings.push(WarningDto::new(
                "git_missing",
                "未检测到系统 Git，写操作不可用；只读功能不受影响",
            ));
        } else if !self.git_version_supported {
            warnings.push(
                WarningDto::new(
                    "git_version_too_old",
                    format!("系统 Git 版本低于 {MINIMUM_GIT_VERSION}，写操作已禁用，请升级 Git"),
                )
                .with_arg("minimum", MINIMUM_GIT_VERSION),
            );
        }
        if repo.is_bare() {
            warnings.push(WarningDto::new(
                "bare_repository",
                "裸仓库：工作区相关写操作不可用",
            ));
        }
        warnings
    }
}

fn gix_error(err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "读取 Git 数据失败").with_detail(err.to_string())
}

pub(crate) fn tree_oid_of_commit(repo: &gix::Repository, oid: &Oid) -> Result<Oid> {
    let commit = find_commit(repo, oid)?;
    tree_oid_of_object(&commit)
}

fn tree_oid_of_object(commit: &gix::Commit<'_>) -> Result<Oid> {
    let id = commit.tree_id().map_err(gix_error)?;
    Ok(oid_from_id(&id))
}

pub(crate) fn reachable_set(repo: &gix::Repository, oid: &Oid) -> Result<HashSet<Oid>> {
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
