//! 单文件 patch：按路径定位条目、读取原始字节、生成统一 diff 文本。

use git_core::{
    apply_patch_limit, binary_note, image_data_uri, image_kind, image_media_type, too_large_note,
    ErrorCode, FileDiffDto, FileStatus, Oid, Result, UserVisibleError, MAX_DIFF_BYTES,
};

use crate::util::{decode_text, find_tree, lossy, oid_from_gix, try_object_bytes};

use super::tree_changes::tree_entry_error;
use super::unified::build_patch;

/// 单文件 diff：直接按路径查找两侧条目，避免为单个文件重算整棵树。
pub(crate) fn diff_file(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    path: &str,
    ignore_whitespace: bool,
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
    let status = status_of(old_oid.as_ref(), new_oid.as_ref());
    let old_bytes = old_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
    let new_bytes = new_oid.as_ref().and_then(|oid| try_object_bytes(repo, oid));
    Ok(diff_content(
        path,
        status,
        old_oid.as_ref(),
        new_oid.as_ref(),
        old_bytes,
        new_bytes,
        gitlink,
        ignore_whitespace,
    ))
}

/// 由两侧是否存在推导文件状态。
pub(crate) fn status_of(old_oid: Option<&Oid>, new_oid: Option<&Oid>) -> FileStatus {
    match (old_oid, new_oid) {
        (None, Some(_)) => FileStatus::Added,
        (Some(_), None) => FileStatus::Deleted,
        _ => FileStatus::Modified,
    }
}

/// 用两侧原始字节构造 `FileDiffDto`（树 diff、工作区对比与 stash 预览共用）。
///
/// 降级顺序与既有读取路径一致：gitlink → 超过 2MB → 图片预览 → 二进制 →
/// 文本 patch（可选忽略空白）→ patch 行数上限。图片预览只在两侧都不超限时附加，
/// 不改变文本降级行为。
#[allow(clippy::too_many_arguments)]
pub(crate) fn diff_content(
    path: &str,
    status: FileStatus,
    old_oid: Option<&Oid>,
    new_oid: Option<&Oid>,
    old_bytes: Option<Vec<u8>>,
    new_bytes: Option<Vec<u8>>,
    gitlink: bool,
    ignore_whitespace: bool,
) -> FileDiffDto {
    let mut dto = FileDiffDto {
        generation: 0,
        path: path.to_owned(),
        old_path: old_oid.map(|_| path.to_owned()),
        status,
        patch: None,
        binary: false,
        too_large: false,
        truncated: false,
        encoding_fallback: false,
        gitlink,
        gitlink_old: old_oid.cloned(),
        gitlink_new: new_oid.cloned(),
        additions: 0,
        deletions: 0,
        language: language_for(path),
        note: None,
        note_code: None,
        note_args: None,
        image_before: None,
        image_after: None,
        image_kind: None,
    };

    if gitlink {
        dto.set_note("diff_gitlink", "子模块（gitlink）变更，仅显示对象 ID");
        return dto;
    }

    if old_bytes.as_ref().map(|b| b.len()).unwrap_or(0) > MAX_DIFF_BYTES
        || new_bytes.as_ref().map(|b| b.len()).unwrap_or(0) > MAX_DIFF_BYTES
    {
        dto.too_large = true;
        dto.set_note("diff_too_large", too_large_note());
        return dto;
    }

    attach_image_preview(&mut dto, path, old_bytes.as_deref(), new_bytes.as_deref());

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
        return dto;
    }

    let old_text = old_decoded.as_ref().map(|t| t.text.as_str()).unwrap_or("");
    let new_text = new_decoded.as_ref().map(|t| t.text.as_str()).unwrap_or("");
    let stats = build_patch(path, old_text, new_text, ignore_whitespace);
    dto.additions = stats.additions;
    dto.deletions = stats.deletions;
    if ignore_whitespace && stats.text.lines().count() <= 2 {
        // 只剩 `---` / `+++` 两行文件头：忽略空白后没有可见变更。
        dto.patch = Some(stats.text);
        dto.set_note("diff_ignore_whitespace", "忽略空白差异后没有可见变更");
        return dto;
    }
    apply_patch_limit(&mut dto, stats.text);
    dto
}

fn attach_image_preview(
    dto: &mut FileDiffDto,
    path: &str,
    old_bytes: Option<&[u8]>,
    new_bytes: Option<&[u8]>,
) {
    let Some(media_type) = image_media_type(path) else {
        return;
    };
    dto.image_kind = image_kind(path);
    dto.image_before = old_bytes.map(|bytes| image_data_uri(media_type, bytes));
    dto.image_after = new_bytes.map(|bytes| image_data_uri(media_type, bytes));
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

pub(crate) fn lookup_path(
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
