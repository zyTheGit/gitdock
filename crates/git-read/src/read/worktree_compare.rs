//! 当前工作区与提交的快照对比（ADR-0030）。
//!
//! 实现方式：用 `gix` status 以指定提交的树为「HEAD 树」，同时枚举
//! 「提交树 ↔ 索引」与「索引 ↔ 工作区」两组变更，取路径并集后再按路径读取
//! 提交树条目与工作区文件内容，自行统计增删行。整个过程只读：
//! 不写文件、不启动子进程、不把 status 的 index 缓冲写回 `.git/index`。
//!
//! 已知边界（写入 ADR）：不做重命名检测；只改 mode 的变更不列出；子模块状态
//! 不展开；工作区侧没有对象 OID，`new_oid` 恒为 None。

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use git_core::{
    too_large_note, ChangedFileDto, CompareMode, CompareResultDto, ErrorCode, FileDiffDto,
    FileStatus, Oid, Result, UserVisibleError, WarningDto, WorktreeSide, MAX_DIFF_BYTES,
};
use gix::bstr::ByteSlice;
use similar::{ChangeTag, TextDiff};

use super::{gix_error, read_head, tree_oid_of_commit, GitReadModule};
use crate::diff::{diff_content, lookup_path, MAX_FILES};
use crate::util::{decode_text, find_commit, gix_oid, try_object_bytes};

/// 对比槽位里表示「当前工作区」的保留字；只有 git-read 解释它的含义。
pub const WORKTREE_REF: &str = "worktree";

pub(crate) struct WorktreeChange {
    pub path: String,
    pub old_oid: Option<Oid>,
    pub new_oid: Option<Oid>,
    pub status: FileStatus,
    pub binary: bool,
    pub gitlink: bool,
    pub additions: u32,
    pub deletions: u32,
}

impl WorktreeChange {
    fn to_dto(&self) -> ChangedFileDto {
        ChangedFileDto {
            path: self.path.clone(),
            old_path: self.old_oid.as_ref().map(|_| self.path.clone()),
            status: self.status,
            additions: self.additions,
            deletions: self.deletions,
            binary: self.binary,
            gitlink: self.gitlink,
            old_oid: self.old_oid.clone(),
            new_oid: self.new_oid.clone(),
            change_origin: None,
        }
    }

    /// 交换展示方向（工作区作为 Base 时，文件状态与增删数要反过来看）。
    fn reverse(&mut self) {
        self.status = match self.status {
            FileStatus::Added => FileStatus::Deleted,
            FileStatus::Deleted => FileStatus::Added,
            other => other,
        };
        std::mem::swap(&mut self.additions, &mut self.deletions);
        std::mem::swap(&mut self.old_oid, &mut self.new_oid);
    }
}

enum WorktreeFile {
    Missing,
    TooLarge,
    Other,
    Regular(Vec<u8>),
}

impl GitReadModule {
    /// 工作区与指定提交的两端对比。`worktree_is_base` 决定工作区落在哪一侧。
    pub fn compare_worktree(
        &self,
        commit: &Oid,
        worktree_is_base: bool,
        path_filter: Option<&str>,
    ) -> Result<CompareResultDto> {
        let repo = self.repo()?;
        let _ = find_commit(&repo, commit)?;
        let root = self.worktree_root(&repo)?;
        let (mut changes, truncated) = collect_worktree_changes(&repo, &root, commit, path_filter)?;
        if worktree_is_base {
            for change in &mut changes {
                change.reverse();
            }
        }
        let placeholder = read_head(&repo)?.oid.unwrap_or_else(|| commit.clone());
        let (base, compare) = if worktree_is_base {
            (placeholder, commit.clone())
        } else {
            (commit.clone(), placeholder)
        };
        let mut warnings = Vec::new();
        if truncated {
            warnings.push(
                WarningDto::new(
                    "diff_truncated",
                    format!("变更文件过多，仅显示前 {} 个文件", changes.len()),
                )
                .with_arg("n", changes.len().to_string()),
            );
        }
        let title = if worktree_is_base {
            format!("工作区 → {}", commit.short(7))
        } else {
            format!("{} → 工作区", commit.short(7))
        };
        Ok(CompareResultDto {
            generation: self.fingerprint(&repo)?,
            base,
            compare,
            merge_base: None,
            merge_base_summary: None,
            mode: CompareMode::Worktree,
            base_only: 0,
            compare_only: 0,
            files: changes.iter().map(WorktreeChange::to_dto).collect(),
            commits: Vec::new(),
            commits_truncated: false,
            base_commits: Vec::new(),
            base_commits_truncated: false,
            equivalent_commits: Default::default(),
            title,
            warnings,
            worktree_side: Some(if worktree_is_base {
                WorktreeSide::Base
            } else {
                WorktreeSide::Compare
            }),
        })
    }

    /// 工作区对比中的单文件 diff；方向与 `worktree_is_base` 保持一致。
    pub fn compare_worktree_file_diff(
        &self,
        commit: &Oid,
        worktree_is_base: bool,
        path: &str,
        ignore_whitespace: bool,
    ) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        let root = self.worktree_root(&repo)?;
        let tree_oid = tree_oid_of_commit(&repo, commit)?;
        let entry = lookup_path(&repo, &tree_oid, path)?;
        let (tree_mode, tree_blob) = match entry {
            Some((mode, oid)) => (Some(mode), Some(oid)),
            None => (None, None),
        };
        let gitlink = tree_mode.map(|mode| mode.is_commit()).unwrap_or(false);
        let tree_bytes = if gitlink {
            None
        } else {
            tree_blob
                .as_ref()
                .and_then(|oid| try_object_bytes(&repo, oid))
        };
        let worktree = read_worktree(&root, path);
        let worktree_present = !matches!(worktree, WorktreeFile::Missing);
        if tree_blob.is_none() && !worktree_present {
            return Err(UserVisibleError::new(
                ErrorCode::FileNotFound,
                format!("提交与工作区中都没有文件 {path}"),
            )
            .with_key("errors.readFileNotInCommit")
            .with_arg("path", path));
        }
        let worktree_bytes = match &worktree {
            WorktreeFile::Regular(bytes) => Some(bytes.clone()),
            _ => None,
        };
        let status = status_for(tree_blob.is_some(), worktree_present);
        let (old_oid, new_oid) = if worktree_is_base {
            (None, tree_blob.as_ref())
        } else {
            (tree_blob.as_ref(), None)
        };
        let (old_bytes, new_bytes) = if worktree_is_base {
            (worktree_bytes, tree_bytes)
        } else {
            (tree_bytes, worktree_bytes)
        };
        let mut dto = diff_content(
            path,
            status,
            old_oid,
            new_oid,
            old_bytes,
            new_bytes,
            gitlink,
            ignore_whitespace,
        );
        apply_worktree_degradation(&mut dto, &worktree);
        dto.generation = self.fingerprint(&repo)?;
        Ok(dto)
    }

    fn worktree_root(&self, repo: &gix::Repository) -> Result<PathBuf> {
        repo.workdir().map(Path::to_path_buf).ok_or_else(|| {
            UserVisibleError::new(ErrorCode::BareRepository, "bare 仓库没有工作区，无法对比")
                .with_key("errors.readWorktreeUnavailable")
        })
    }
}

fn apply_worktree_degradation(dto: &mut FileDiffDto, worktree: &WorktreeFile) {
    match worktree {
        WorktreeFile::TooLarge => {
            dto.too_large = true;
            dto.patch = None;
            dto.additions = 0;
            dto.deletions = 0;
            dto.set_note("diff_too_large", too_large_note());
        }
        WorktreeFile::Other => {
            dto.binary = true;
            dto.patch = None;
            dto.additions = 0;
            dto.deletions = 0;
            dto.set_note(
                "diff_worktree_not_file",
                "工作区中该路径不是普通文件，无法显示文本差异",
            );
        }
        WorktreeFile::Missing | WorktreeFile::Regular(_) => {}
    }
}

fn status_for(old_present: bool, new_present: bool) -> FileStatus {
    match (old_present, new_present) {
        (false, true) => FileStatus::Added,
        (true, false) => FileStatus::Deleted,
        _ => FileStatus::Modified,
    }
}

fn collect_worktree_changes(
    repo: &gix::Repository,
    root: &Path,
    commit: &Oid,
    path_filter: Option<&str>,
) -> Result<(Vec<WorktreeChange>, bool)> {
    let tree_oid = tree_oid_of_commit(repo, commit)?;
    let platform = repo
        .status(gix::progress::Discard)
        .map_err(gix_error)?
        .head_tree(gix_oid(&tree_oid)?)
        .tree_index_track_renames(gix::status::tree_index::TrackRenames::Disabled)
        .untracked_files(gix::status::UntrackedFiles::Files)
        .index_worktree_submodules(None::<gix::status::Submodule>);
    let mut paths = BTreeSet::new();
    for item in platform.into_iter(Vec::new()).map_err(gix_error)? {
        let item = item.map_err(gix_error)?;
        let path = item.location().to_str_lossy().to_string();
        if path_matches(&path, path_filter) {
            paths.insert(path);
        }
    }

    let mut changes = Vec::new();
    let mut truncated = false;
    for path in paths {
        if changes.len() >= MAX_FILES {
            truncated = true;
            break;
        }
        let entry = lookup_path(repo, &tree_oid, &path)?;
        let (tree_mode, tree_blob) = match entry {
            Some((mode, oid)) => (Some(mode), Some(oid)),
            None => (None, None),
        };
        let gitlink = tree_mode.map(|mode| mode.is_commit()).unwrap_or(false);
        let worktree = read_worktree(root, &path);
        let worktree_present = !matches!(worktree, WorktreeFile::Missing);
        if tree_blob.is_none() && !worktree_present {
            continue;
        }
        let old_bytes = if gitlink {
            None
        } else {
            tree_blob
                .as_ref()
                .and_then(|oid| try_object_bytes(repo, oid))
        };
        let new_bytes = match &worktree {
            WorktreeFile::Regular(bytes) => Some(bytes.clone()),
            _ => None,
        };
        if let (Some(old), Some(new)) = (&old_bytes, &new_bytes) {
            // 内容相同（例如暂存后又改回提交内容）不算工作区变更。
            if old == new && tree_blob.is_some() {
                continue;
            }
        }
        let (binary, additions, deletions) =
            if gitlink || matches!(worktree, WorktreeFile::TooLarge | WorktreeFile::Other) {
                (true, 0, 0)
            } else {
                line_stats(old_bytes.as_deref(), new_bytes.as_deref())
            };
        changes.push(WorktreeChange {
            path,
            old_oid: tree_blob,
            new_oid: None,
            status: status_for(tree_mode.is_some(), worktree_present),
            binary,
            gitlink,
            additions,
            deletions,
        });
    }
    Ok((changes, truncated))
}

/// 与 `compare` 的路径过滤语义一致：前缀命中或包含关键字即可。
fn path_matches(path: &str, filter: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(filter) => path.starts_with(filter) || path.contains(filter),
    }
}

fn read_worktree(root: &Path, path: &str) -> WorktreeFile {
    let full = root.join(path);
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        return WorktreeFile::Missing;
    };
    if meta.file_type().is_symlink() {
        // Git 对符号链接存的是链接目标文本，这里按同样语义比较。
        return match std::fs::read_link(&full) {
            Ok(target) => WorktreeFile::Regular(target.to_string_lossy().into_owned().into_bytes()),
            Err(_) => WorktreeFile::Other,
        };
    }
    if !meta.is_file() {
        return WorktreeFile::Other;
    }
    if meta.len() > MAX_DIFF_BYTES as u64 {
        return WorktreeFile::TooLarge;
    }
    match std::fs::read(&full) {
        Ok(bytes) => WorktreeFile::Regular(bytes),
        Err(_) => WorktreeFile::Other,
    }
}

fn line_stats(old: Option<&[u8]>, new: Option<&[u8]>) -> (bool, u32, u32) {
    let old_text = old.map(decode_text);
    let new_text = new.map(decode_text);
    let binary = old_text.as_ref().is_some_and(|text| text.binary)
        || new_text.as_ref().is_some_and(|text| text.binary);
    if binary {
        return (true, 0, 0);
    }
    let diff = TextDiff::from_lines(
        old_text
            .as_ref()
            .map(|text| text.text.as_str())
            .unwrap_or(""),
        new_text
            .as_ref()
            .map(|text| text.text.as_str())
            .unwrap_or(""),
    );
    let mut additions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }
    (false, additions, deletions)
}

/// 供命令层判断槽位是否为工作区保留字。
pub fn is_worktree_ref(value: &str) -> bool {
    value == WORKTREE_REF
}
