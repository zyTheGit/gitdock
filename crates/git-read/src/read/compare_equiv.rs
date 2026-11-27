//! 分叉对比中两侧等价提交（cherry-pick / rebase 同步）识别。
//!
//! 思路与 `git patch-id` 一致：对单父提交相对第一父提交的增删行内容计算 SHA-256 指纹，
//! 忽略上下文行号与提交元信息；两侧指纹一致时建立双向映射。

use std::collections::{BTreeMap, HashMap};

use git_core::{CommitSummaryDto, Oid, Result};
use sha2::{Digest, Sha256};
use similar::{ChangeTag, TextDiff};

use super::{tree_oid_of_commit, tree_oid_of_object};
use crate::diff::collect_changes;
use crate::util::{decode_text, find_commit, oid_from_id, try_object_bytes};

/// 单侧最多计算等价指纹的提交数，避免超大历史对比阻塞。
const MAX_EQUIV_COMMITS: usize = 40;
/// 参与指纹计算的单文件字节上限。
const MAX_EQUIV_FILE_BYTES: usize = 256 * 1024;
/// 单个提交超过该变更文件数时跳过等价指纹（如批量格式化/大规模重命名）。
const MAX_EQUIV_FILES_PER_COMMIT: usize = 50;

pub(crate) fn compute_equivalent_commits(
    repo: &gix::Repository,
    base_commits: &[CommitSummaryDto],
    compare_commits: &[CommitSummaryDto],
) -> Result<BTreeMap<String, String>> {
    if base_commits.is_empty() || compare_commits.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut base_by_fp: HashMap<[u8; 32], String> = HashMap::new();
    for commit in base_commits.iter().take(MAX_EQUIV_COMMITS) {
        if let Some(fp) = commit_patch_fingerprint(repo, &commit.oid)? {
            base_by_fp
                .entry(fp)
                .or_insert_with(|| commit.oid.as_str().to_owned());
        }
    }
    if base_by_fp.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut map = BTreeMap::new();
    for commit in compare_commits.iter().take(MAX_EQUIV_COMMITS) {
        if let Some(fp) = commit_patch_fingerprint(repo, &commit.oid)? {
            if let Some(base_oid) = base_by_fp.get(&fp) {
                let comp_oid = commit.oid.as_str().to_owned();
                map.entry(comp_oid.clone())
                    .or_insert_with(|| base_oid.clone());
                map.entry(base_oid.clone()).or_insert(comp_oid);
            }
        }
    }
    Ok(map)
}

fn commit_patch_fingerprint(repo: &gix::Repository, oid: &Oid) -> Result<Option<[u8; 32]>> {
    let commit = find_commit(repo, oid)?;
    let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
    // 合并提交不参与 cherry-pick 等价匹配。
    if parents.len() > 1 {
        return Ok(None);
    }
    let old_tree = match parents.first() {
        Some(parent) => Some(tree_oid_of_commit(repo, parent)?),
        None => None,
    };
    let new_tree = Some(tree_oid_of_object(&commit)?);
    let changes = collect_changes(repo, old_tree.as_ref(), new_tree.as_ref(), None)?;
    if changes.files.is_empty() || changes.files.len() > MAX_EQUIV_FILES_PER_COMMIT {
        return Ok(None);
    }

    let mut hasher = Sha256::new();
    for file in &changes.files {
        hasher.update(file.path().as_bytes());
        hasher.update(b"\0");
        hasher.update(format!("{:?}", file.status).as_bytes());
        hasher.update(b"\0");

        if file.binary || file.gitlink {
            if let Some(oid) = &file.old_oid {
                hasher.update(oid.as_str().as_bytes());
            }
            hasher.update(b"->");
            if let Some(oid) = &file.new_oid {
                hasher.update(oid.as_str().as_bytes());
            }
            hasher.update(b"\n");
            continue;
        }

        let old_bytes = file
            .old_oid
            .as_ref()
            .and_then(|id| try_object_bytes(repo, id))
            .unwrap_or_default();
        let new_bytes = file
            .new_oid
            .as_ref()
            .and_then(|id| try_object_bytes(repo, id))
            .unwrap_or_default();
        if old_bytes.len() > MAX_EQUIV_FILE_BYTES || new_bytes.len() > MAX_EQUIV_FILE_BYTES {
            if let Some(oid) = &file.new_oid {
                hasher.update(oid.as_str().as_bytes());
            }
            continue;
        }
        let old_text = decode_text(&old_bytes).text;
        let new_text = decode_text(&new_bytes).text;
        let diff = TextDiff::from_lines(&old_text, &new_text);
        for change in diff.iter_all_changes() {
            match change.tag() {
                ChangeTag::Insert => {
                    hasher.update(b"+");
                    hasher.update(change.value().trim_end_matches(['\r', '\n']).as_bytes());
                    hasher.update(b"\n");
                }
                ChangeTag::Delete => {
                    hasher.update(b"-");
                    hasher.update(change.value().trim_end_matches(['\r', '\n']).as_bytes());
                    hasher.update(b"\n");
                }
                ChangeTag::Equal => {}
            }
        }
    }
    Ok(Some(hasher.finalize().into()))
}
