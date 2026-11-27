//! 树级遍历：收集两棵树之间的变更、按路径剪枝匹配、统计增删行。

use std::collections::BTreeMap;

use git_core::{ChangedFileDto, ErrorCode, FileStatus, Oid, Result, UserVisibleError};
use similar::{ChangeTag, TextDiff};

use crate::util::{decode_text, find_tree, lossy, oid_from_gix, try_object_bytes};

pub(crate) const MAX_FILES: usize = 5000;
pub(crate) const MAX_LINE_COUNT_FILES: usize = 2000;

#[derive(Debug, Clone)]
pub(crate) struct RawChange {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub old_oid: Option<Oid>,
    pub new_oid: Option<Oid>,
    pub status: FileStatus,
    pub binary: bool,
    pub gitlink: bool,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct ChangeSet {
    pub files: Vec<RawChange>,
    pub truncated: bool,
}

impl RawChange {
    pub fn path(&self) -> &str {
        self.new_path
            .as_deref()
            .or(self.old_path.as_deref())
            .unwrap_or("")
    }

    pub fn to_dto(&self) -> ChangedFileDto {
        ChangedFileDto {
            path: self.path().to_owned(),
            old_path: self.old_path.clone(),
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
}

struct EntryInfo {
    mode: gix::object::tree::EntryMode,
    oid: Oid,
}

/// 计算两棵树之间的变更；root 为 None 表示空树。
pub(crate) fn collect_changes(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    path_filter: Option<&str>,
) -> Result<ChangeSet> {
    let old = match old_tree {
        Some(oid) => Some(find_tree(repo, oid)?),
        None => None,
    };
    let new = match new_tree {
        Some(oid) => Some(find_tree(repo, oid)?),
        None => None,
    };
    let mut files = Vec::new();
    let mut truncated = false;
    collect_node(
        repo,
        old.as_ref(),
        new.as_ref(),
        "",
        path_filter,
        &mut files,
        &mut truncated,
    )?;
    Ok(ChangeSet { files, truncated })
}

fn collect_node(
    repo: &gix::Repository,
    old: Option<&gix::Tree<'_>>,
    new: Option<&gix::Tree<'_>>,
    prefix: &str,
    path_filter: Option<&str>,
    out: &mut Vec<RawChange>,
    truncated: &mut bool,
) -> Result<()> {
    if *truncated {
        return Ok(());
    }
    let old_entries = entries_of(old)?;
    let new_entries = entries_of(new)?;
    let mut names: Vec<&String> = old_entries.keys().chain(new_entries.keys()).collect();
    names.sort();
    names.dedup();

    for name in names {
        if out.len() >= MAX_FILES {
            *truncated = true;
            return Ok(());
        }
        let path = format!("{prefix}{name}");
        if let Some(filter) = path_filter {
            if !path.starts_with(filter) {
                // 过滤路径本身可能是目录前缀，只有在完全无关时才跳过。
                if !path.contains(filter) {
                    continue;
                }
            }
        }
        let old_entry = old_entries.get(name);
        let new_entry = new_entries.get(name);
        match (old_entry, new_entry) {
            (Some(old_entry), Some(new_entry)) if old_entry.oid == new_entry.oid => {
                match (old_entry.mode.is_tree(), new_entry.mode.is_tree()) {
                    (true, true) | (false, false) => continue,
                    _ => {}
                }
            }
            _ => {}
        }
        match (old_entry, new_entry) {
            (Some(old_entry), Some(new_entry)) => {
                if old_entry.mode.is_tree() && new_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    collect_node(
                        repo,
                        Some(&old_child),
                        Some(&new_child),
                        &format!("{path}/"),
                        path_filter,
                        out,
                        truncated,
                    )?;
                } else if old_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    collect_node(
                        repo,
                        Some(&old_child),
                        None,
                        &format!("{path}/"),
                        path_filter,
                        out,
                        truncated,
                    )?;
                    push_blob_or_gitlink(repo, None, Some(new_entry), None, Some(&path), out)?;
                } else if new_entry.mode.is_tree() {
                    push_blob_or_gitlink(repo, Some(old_entry), None, Some(&path), None, out)?;
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    collect_node(
                        repo,
                        None,
                        Some(&new_child),
                        &format!("{path}/"),
                        path_filter,
                        out,
                        truncated,
                    )?;
                } else {
                    push_blob_or_gitlink(
                        repo,
                        Some(old_entry),
                        Some(new_entry),
                        Some(&path),
                        Some(&path),
                        out,
                    )?;
                }
            }
            (Some(old_entry), None) => {
                if old_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    collect_node(
                        repo,
                        Some(&old_child),
                        None,
                        &format!("{path}/"),
                        path_filter,
                        out,
                        truncated,
                    )?;
                } else {
                    push_blob_or_gitlink(repo, Some(old_entry), None, Some(&path), None, out)?;
                }
            }
            (None, Some(new_entry)) => {
                if new_entry.mode.is_tree() {
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    collect_node(
                        repo,
                        None,
                        Some(&new_child),
                        &format!("{path}/"),
                        path_filter,
                        out,
                        truncated,
                    )?;
                } else {
                    push_blob_or_gitlink(repo, None, Some(new_entry), None, Some(&path), out)?;
                }
            }
            (None, None) => {}
        }
    }
    Ok(())
}

/// 在两棵树之间寻找第一个改动路径包含 `needle` 的文件。
///
/// 只做树级遍历并剪枝相同子树，命中即返回；不读取 blob 内容，也不统计增删行，
/// 因此比 `collect_changes` 快一个量级——搜索路径时每个提交都要调用一次。
pub(crate) fn changed_path_matching(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    needle: &str,
) -> Result<Option<String>> {
    let old = match old_tree {
        Some(oid) => Some(find_tree(repo, oid)?),
        None => None,
    };
    let new = match new_tree {
        Some(oid) => Some(find_tree(repo, oid)?),
        None => None,
    };
    match_changed_node(repo, old.as_ref(), new.as_ref(), "", needle)
}

fn match_changed_node(
    repo: &gix::Repository,
    old: Option<&gix::Tree<'_>>,
    new: Option<&gix::Tree<'_>>,
    prefix: &str,
    needle: &str,
) -> Result<Option<String>> {
    let old_entries = entries_of(old)?;
    let new_entries = entries_of(new)?;
    let mut names: Vec<&String> = old_entries.keys().chain(new_entries.keys()).collect();
    names.sort();
    names.dedup();

    for name in names {
        let path = format!("{prefix}{name}");
        let old_entry = old_entries.get(name);
        let new_entry = new_entries.get(name);
        match (old_entry, new_entry) {
            (None, None) => {}
            (Some(old_entry), Some(new_entry))
                if old_entry.oid == new_entry.oid
                    && old_entry.mode.is_tree() == new_entry.mode.is_tree() => {}
            (Some(old_entry), Some(new_entry)) => {
                if old_entry.mode.is_tree() && new_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    if let Some(hit) = match_changed_node(
                        repo,
                        Some(&old_child),
                        Some(&new_child),
                        &format!("{path}/"),
                        needle,
                    )? {
                        return Ok(Some(hit));
                    }
                } else if old_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    if let Some(hit) = match_changed_node(
                        repo,
                        Some(&old_child),
                        None,
                        &format!("{path}/"),
                        needle,
                    )? {
                        return Ok(Some(hit));
                    }
                    if let Some(hit) = leaf_matching(&path, needle) {
                        return Ok(Some(hit));
                    }
                } else if new_entry.mode.is_tree() {
                    if let Some(hit) = leaf_matching(&path, needle) {
                        return Ok(Some(hit));
                    }
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    if let Some(hit) = match_changed_node(
                        repo,
                        None,
                        Some(&new_child),
                        &format!("{path}/"),
                        needle,
                    )? {
                        return Ok(Some(hit));
                    }
                } else if let Some(hit) = leaf_matching(&path, needle) {
                    return Ok(Some(hit));
                }
            }
            (Some(old_entry), None) => {
                if old_entry.mode.is_tree() {
                    let old_child = find_tree(repo, &old_entry.oid)?;
                    if let Some(hit) = match_changed_node(
                        repo,
                        Some(&old_child),
                        None,
                        &format!("{path}/"),
                        needle,
                    )? {
                        return Ok(Some(hit));
                    }
                } else if let Some(hit) = leaf_matching(&path, needle) {
                    return Ok(Some(hit));
                }
            }
            (None, Some(new_entry)) => {
                if new_entry.mode.is_tree() {
                    let new_child = find_tree(repo, &new_entry.oid)?;
                    if let Some(hit) = match_changed_node(
                        repo,
                        None,
                        Some(&new_child),
                        &format!("{path}/"),
                        needle,
                    )? {
                        return Ok(Some(hit));
                    }
                } else if let Some(hit) = leaf_matching(&path, needle) {
                    return Ok(Some(hit));
                }
            }
        }
    }
    Ok(None)
}

fn leaf_matching(path: &str, needle: &str) -> Option<String> {
    path.to_lowercase()
        .contains(needle)
        .then(|| path.to_owned())
}

pub(super) fn tree_entry_error(err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "读取树条目失败")
        .with_key("errors.readTreeEntryFailed")
        .with_detail(err.to_string())
}

fn entries_of(tree: Option<&gix::Tree<'_>>) -> Result<BTreeMap<String, EntryInfo>> {
    let mut map = BTreeMap::new();
    if let Some(tree) = tree {
        for entry in tree.iter() {
            let entry = entry.map_err(tree_entry_error)?;
            map.insert(
                lossy(entry.filename().as_ref()),
                EntryInfo {
                    mode: entry.mode(),
                    oid: oid_from_gix(entry.oid()),
                },
            );
        }
    }
    Ok(map)
}

fn push_blob_or_gitlink(
    repo: &gix::Repository,
    old: Option<&EntryInfo>,
    new: Option<&EntryInfo>,
    old_path: Option<&str>,
    new_path: Option<&str>,
    out: &mut Vec<RawChange>,
) -> Result<()> {
    let gitlink = old.map(|e| e.mode.is_commit()).unwrap_or(false)
        || new.map(|e| e.mode.is_commit()).unwrap_or(false);
    let status = match (old, new) {
        (None, Some(_)) => FileStatus::Added,
        (Some(_), None) => FileStatus::Deleted,
        (Some(_), Some(_)) => FileStatus::Modified,
        (None, None) => return Ok(()),
    };
    let old_oid = old.map(|e| e.oid.clone());
    let new_oid = new.map(|e| e.oid.clone());
    let mut binary = gitlink;
    let mut additions = 0u32;
    let mut deletions = 0u32;

    if !gitlink && out.len() < MAX_LINE_COUNT_FILES {
        let old_bytes = old_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
        let new_bytes = new_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
        let old_text = old_bytes.as_deref().map(decode_text);
        let new_text = new_bytes.as_deref().map(decode_text);
        binary = old_text.as_ref().map(|t| t.binary).unwrap_or(false)
            || new_text.as_ref().map(|t| t.binary).unwrap_or(false);
        if !binary {
            let old_str = old_text.as_ref().map(|t| t.text.as_str()).unwrap_or("");
            let new_str = new_text.as_ref().map(|t| t.text.as_str()).unwrap_or("");
            let diff = TextDiff::from_lines(old_str, new_str);
            for change in diff.iter_all_changes() {
                match change.tag() {
                    ChangeTag::Insert => additions += 1,
                    ChangeTag::Delete => deletions += 1,
                    ChangeTag::Equal => {}
                }
            }
        }
    }

    out.push(RawChange {
        old_path: old_path.map(str::to_owned),
        new_path: new_path.map(str::to_owned),
        old_oid,
        new_oid,
        status,
        binary,
        gitlink,
        additions,
        deletions,
    });
    Ok(())
}
