//! 行级追溯（Blame）：沿第一父链逐行归因，算法与限制见 ADR-0031 §2.5。
//!
//! gix 0.90 的 `Repository::blame_file` 需要额外的实验性 `gix-blame` 依赖，本模块用
//! 「父版本与本版本逐行 diff，未变化的行交给父提交」的等效算法实现。

use std::collections::HashMap;

use git_core::{
    BlameLineDto, CommitSummaryDto, ErrorCode, FileBlameDto, Oid, Result, UserVisibleError,
    MAX_DIFF_BYTES,
};
use similar::{DiffOp, TextDiff};

use super::{commit_summary, gix_error, tree_oid_of_commit, GitReadModule, RefBadges};
use crate::diff::lookup_path;
use crate::util::{decode_text, find_commit, normalize_repo_path, oid_from_id, try_object_bytes};

/// 回溯的提交上限：超过后剩余行归到边界提交，避免超深历史拖死交互。
const MAX_BLAME_COMMITS: usize = 4096;

impl GitReadModule {
    /// 逐行追溯 `path` 在 `oid` 版本中的归属提交。二进制/超大文件只返回降级标记。
    pub fn read_file_blame(&self, oid: &Oid, path: &str) -> Result<FileBlameDto> {
        let path = normalize_repo_path(path)?;
        let repo = self.repo()?;
        let mut dto = FileBlameDto {
            generation: self.fingerprint(&repo)?,
            oid: oid.clone(),
            path: path.clone(),
            lines: Vec::new(),
            binary: false,
            too_large: false,
            encoding_fallback: false,
            language: git_core::language_for(&path),
        };

        let commit = find_commit(&repo, oid)?;
        let tree = oid_from_id(&commit.tree_id().map_err(gix_error)?);
        let Some((mode, blob_oid)) = lookup_path(&repo, &tree, &path)? else {
            return Err(UserVisibleError::new(
                ErrorCode::FileNotFound,
                format!("提交中没有文件 {path}"),
            )
            .with_key("errors.readFileNotInCommit")
            .with_arg("path", path));
        };
        // 子模块（gitlink）内容不在本仓库，按二进制降级。
        if mode.is_commit() {
            dto.binary = true;
            return Ok(dto);
        }
        let Some(bytes) = try_object_bytes(&repo, &blob_oid) else {
            return Err(
                UserVisibleError::new(ErrorCode::Internal, "读取文件内容失败")
                    .with_key("errors.readGitObjectFailed"),
            );
        };
        if bytes.len() > MAX_DIFF_BYTES {
            dto.too_large = true;
            return Ok(dto);
        }
        let decoded = decode_text(&bytes);
        dto.encoding_fallback = decoded.encoding_fallback;
        if decoded.binary {
            dto.binary = true;
            return Ok(dto);
        }

        let attribution = attribute_lines(&repo, oid, &path, &decoded.text, &blob_oid)?;
        // Blame 行不需要 ref 徽标，跳过多余的 refs 读取。
        let badges = RefBadges::new();
        let mut summaries: HashMap<Oid, CommitSummaryDto> = HashMap::new();
        for line_oid in &attribution {
            if let std::collections::hash_map::Entry::Vacant(entry) =
                summaries.entry(line_oid.clone())
            {
                entry.insert(commit_summary(&repo, line_oid, &badges)?);
            }
        }
        dto.lines = decoded
            .text
            .lines()
            .zip(attribution)
            .enumerate()
            .map(|(index, (content, line_oid))| {
                let summary = summaries.get(&line_oid).expect("归属提交摘要已按需读取");
                BlameLineDto {
                    line_no: (index + 1) as u32,
                    oid: line_oid,
                    short_oid: summary.short_oid.clone(),
                    author_name: summary.author_name.clone(),
                    authored_at: summary.authored_at,
                    summary: summary.summary.clone(),
                    content: content.to_owned(),
                }
            })
            .collect();
        Ok(dto)
    }
}

/// 计算每一行的归属提交；返回值与 `text.lines()` 一一对应。
fn attribute_lines(
    repo: &gix::Repository,
    start: &Oid,
    path: &str,
    text: &str,
    start_blob: &Oid,
) -> Result<Vec<Oid>> {
    let line_count = text.lines().count();
    let mut attribution: Vec<Option<Oid>> = vec![None; line_count];
    // (目标行下标, 该行在「当前提交」内容中的行下标)；未归属的行才继续回溯。
    let mut pending: Vec<(usize, usize)> = (0..line_count).map(|line| (line, line)).collect();
    let mut current_oid = start.clone();
    let mut current_blob = start_blob.clone();
    let mut current_text = text.to_owned();
    let mut steps = 0usize;

    while !pending.is_empty() {
        if steps >= MAX_BLAME_COMMITS {
            assign(&mut attribution, &pending, &current_oid);
            break;
        }
        let commit = find_commit(repo, &current_oid)?;
        let Some(parent_id) = commit.parent_ids().next() else {
            // 根提交：剩余行都由它引入。
            assign(&mut attribution, &pending, &current_oid);
            break;
        };
        let parent_oid = oid_from_id(&parent_id);
        let parent_tree = tree_oid_of_commit(repo, &parent_oid)?;
        let Some((mode, parent_blob)) = lookup_path(repo, &parent_tree, path)? else {
            // 父提交没有该路径：剩余行由当前提交引入。
            assign(&mut attribution, &pending, &current_oid);
            break;
        };
        if mode.is_commit() {
            assign(&mut attribution, &pending, &current_oid);
            break;
        }
        steps += 1;
        if parent_blob == current_blob {
            // 内容完全一致：全部待定行原样上移，行号不变。
            current_oid = parent_oid;
            continue;
        }
        let Some(parent_bytes) = try_object_bytes(repo, &parent_blob) else {
            assign(&mut attribution, &pending, &current_oid);
            break;
        };
        if parent_bytes.len() > MAX_DIFF_BYTES {
            assign(&mut attribution, &pending, &current_oid);
            break;
        }
        let parent_text = decode_text(&parent_bytes);
        if parent_text.binary {
            assign(&mut attribution, &pending, &current_oid);
            break;
        }
        let parent_lines: Vec<&str> = parent_text.text.lines().collect();
        let current_lines: Vec<&str> = current_text.lines().collect();
        let diff = TextDiff::from_slices(&parent_lines, &current_lines);
        let equal: Vec<(usize, usize, usize)> = diff
            .ops()
            .iter()
            .filter_map(|op| match op {
                DiffOp::Equal {
                    old_index,
                    new_index,
                    len,
                } => Some((*old_index, *new_index, *len)),
                _ => None,
            })
            .collect();
        let mut remaining = Vec::with_capacity(pending.len());
        for &(target, line) in &pending {
            match map_line(&equal, line) {
                Some(parent_line) => remaining.push((target, parent_line)),
                None => attribution[target] = Some(current_oid.clone()),
            }
        }
        pending = remaining;
        current_oid = parent_oid;
        current_blob = parent_blob;
        current_text = parent_text.text;
    }

    // 正常情况下循环内已全部归属；此处兜底防御，避免 unwrap 失败。
    assign(&mut attribution, &pending, &current_oid);
    Ok(attribution
        .into_iter()
        .map(|oid| oid.unwrap_or_else(|| current_oid.clone()))
        .collect())
}

fn assign(attribution: &mut [Option<Oid>], pending: &[(usize, usize)], oid: &Oid) {
    for &(target, _) in pending {
        attribution[target] = Some(oid.clone());
    }
}

/// 在当前版本行号所落到的相等块里，把行号映射到父版本行号。
fn map_line(equal: &[(usize, usize, usize)], line: usize) -> Option<usize> {
    let index = equal
        .partition_point(|(_, new_index, _)| *new_index <= line)
        .checked_sub(1)?;
    let (old_index, new_index, len) = equal[index];
    (line < new_index + len).then(|| old_index + (line - new_index))
}
