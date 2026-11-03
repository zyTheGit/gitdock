//! 自研树 diff：基于 gix 读取树与 blob，输出文件列表与单文件 patch。
//!
//! 降级策略：二进制、超过 2MB 的 blob、超过 5000 行的 patch、gitlink 均不生成文本 patch，
//! 而是返回结构化标记，由前端展示。

use std::collections::BTreeMap;

use git_core::{
    apply_patch_limit, binary_note, too_large_note, ChangedFileDto, ErrorCode, FileDiffDto,
    FileStatus, Oid, Result, UserVisibleError, MAX_DIFF_BYTES,
};
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

fn tree_entry_error(err: impl std::fmt::Display) -> UserVisibleError {
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

/// 单文件 diff：直接按路径查找两侧条目，避免为单个文件重算整棵树。
pub(crate) fn diff_file(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    path: &str,
) -> Result<FileDiffDto> {
    let old_entry = match old_tree {
        Some(tree_oid) => lookup_path(repo, tree_oid, path)?,
        None => None,
    };
    let new_entry = match new_tree {
        Some(tree_oid) => lookup_path(repo, tree_oid, path)?,
        None => None,
    };
    if old_entry.is_none() && new_entry.is_none() {
        return Err(UserVisibleError::new(
            ErrorCode::FileNotFound,
            format!("提交中没有文件 {path}"),
        )
        .with_key("errors.readFileNotInCommit")
        .with_arg("path", path));
    }
    let (old_mode, old_oid) = old_entry
        .map(|(mode, oid)| (Some(mode), Some(oid)))
        .unwrap_or((None, None));
    let (new_mode, new_oid) = new_entry
        .map(|(mode, oid)| (Some(mode), Some(oid)))
        .unwrap_or((None, None));
    let gitlink = old_mode.map(|m| m.is_commit()).unwrap_or(false)
        || new_mode.map(|m| m.is_commit()).unwrap_or(false);
    let status = match (&old_oid, &new_oid) {
        (None, Some(_)) => FileStatus::Added,
        (Some(_), None) => FileStatus::Deleted,
        _ => FileStatus::Modified,
    };

    let mut dto = FileDiffDto {
        generation: 0,
        path: path.to_owned(),
        old_path: old_oid.as_ref().map(|_| path.to_owned()),
        status,
        patch: None,
        binary: false,
        too_large: false,
        truncated: false,
        encoding_fallback: false,
        gitlink,
        gitlink_old: old_oid.clone(),
        gitlink_new: new_oid.clone(),
        additions: 0,
        deletions: 0,
        language: language_for(path),
        note: None,
        note_code: None,
        note_args: None,
    };

    if gitlink {
        dto.set_note("diff_gitlink", "子模块（gitlink）变更，仅显示对象 ID");
        return Ok(dto);
    }

    let old_bytes = old_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
    let new_bytes = new_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
    if old_bytes.as_ref().map(|b| b.len()).unwrap_or(0) > MAX_DIFF_BYTES
        || new_bytes.as_ref().map(|b| b.len()).unwrap_or(0) > MAX_DIFF_BYTES
    {
        dto.too_large = true;
        dto.set_note("diff_too_large", too_large_note());
        return Ok(dto);
    }

    let old_decoded = old_bytes.as_deref().map(decode_text);
    let new_decoded = new_bytes.as_deref().map(decode_text);
    dto.binary = old_decoded.as_ref().map(|t| t.binary).unwrap_or(false)
        || new_decoded.as_ref().map(|t| t.binary).unwrap_or(false);
    dto.encoding_fallback = old_decoded
        .as_ref()
        .map(|t| t.encoding_fallback)
        .unwrap_or(false)
        || new_decoded
            .as_ref()
            .map(|t| t.encoding_fallback)
            .unwrap_or(false);
    if dto.binary {
        dto.set_note("diff_binary", binary_note());
        return Ok(dto);
    }

    let old_text = old_decoded.as_ref().map(|t| t.text.as_str()).unwrap_or("");
    let new_text = new_decoded.as_ref().map(|t| t.text.as_str()).unwrap_or("");
    let diff = TextDiff::from_lines(old_text, new_text);
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => dto.additions += 1,
            ChangeTag::Delete => dto.deletions += 1,
            ChangeTag::Equal => {}
        }
    }
    let old_header = format!("a/{path}");
    let new_header = format!("b/{path}");
    let patch = diff
        .unified_diff()
        .context_radius(3)
        .header(&old_header, &new_header)
        .to_string();
    apply_patch_limit(&mut dto, patch);
    Ok(dto)
}

/// 文件在某侧的原始字节；缺失侧为 None。
pub(crate) type FileBytes = Option<Vec<u8>>;

/// 读取两侧文件原始字节，供外部 diff 工具物化临时文件；缺失侧返回 None。
pub(crate) fn file_bytes(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    path: &str,
) -> Result<(FileBytes, FileBytes)> {
    let read = |tree: Option<&Oid>| -> Result<Option<Vec<u8>>> {
        let Some(tree) = tree else {
            return Ok(None);
        };
        let Some((mode, oid)) = lookup_path(repo, tree, path)? else {
            return Ok(None);
        };
        if mode.is_commit() {
            return Ok(None);
        }
        Ok(try_object_bytes(repo, &oid))
    };
    Ok((read(old_tree)?, read(new_tree)?))
}

fn lookup_path(
    repo: &gix::Repository,
    root_tree: &Oid,
    path: &str,
) -> Result<Option<(gix::object::tree::EntryMode, Oid)>> {
    let mut current = find_tree(repo, root_tree)?;
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Ok(None);
    }
    for (index, part) in parts.iter().enumerate() {
        let mut found = None;
        for entry in current.iter() {
            let entry = entry.map_err(tree_entry_error)?;
            if lossy(entry.filename().as_ref()) == *part {
                found = Some((entry.mode(), oid_from_gix(entry.oid())));
                break;
            }
        }
        let Some((mode, oid)) = found else {
            return Ok(None);
        };
        if index + 1 == parts.len() {
            return Ok(Some((mode, oid)));
        }
        if !mode.is_tree() {
            return Ok(None);
        }
        current = find_tree(repo, &oid)?;
    }
    Ok(None)
}

pub(crate) fn language_for(path: &str) -> Option<String> {
    git_core::language_for(path)
}

#[cfg(test)]
mod path_matching_tests {
    use super::*;

    /// 精简匹配只做树级剪枝，语义必须与 `collect_changes` 的文件清单一致：
    /// 同样取“第一个路径包含关键字”的文件，大小写不敏感。
    #[test]
    fn changed_path_matching_agrees_with_collect_changes() {
        let path = test_support::fixtures().forked();
        let repo = gix::open(path).expect("打开夹具仓库");
        let head = crate::util::oid_from_id(&repo.head_id().expect("HEAD"));
        let index = crate::index::build(&repo, &[head], "test", 0, None).expect("索引");
        let needles = ["feature.txt", "txt", "src", "src ", ".", "zzz", "README"];
        let mut compared = 0usize;
        for oid in &index.order {
            let commit = crate::util::find_commit(&repo, oid).expect("提交");
            let old_tree = commit.parent_ids().next().map(|parent| {
                crate::read::tree_oid_of_commit(&repo, &crate::util::oid_from_id(&parent))
                    .expect("父树")
            });
            let new_tree = Some(crate::util::oid_from_id(&commit.tree_id().expect("提交树")));
            for needle in needles {
                let expected = collect_changes(&repo, old_tree.as_ref(), new_tree.as_ref(), None)
                    .expect("完整 diff")
                    .files
                    .iter()
                    .map(RawChange::path)
                    .map(str::to_owned)
                    .find(|file| file.to_lowercase().contains(needle));
                let actual =
                    changed_path_matching(&repo, old_tree.as_ref(), new_tree.as_ref(), needle)
                        .expect("精简匹配");
                assert_eq!(actual, expected, "oid={} needle={needle}", oid.short(8));
                compared += 1;
            }
        }
        assert!(compared > 0);
    }
}
