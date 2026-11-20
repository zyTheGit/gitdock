//! 本地 stash 读取：`refs/stash` 的 reflog 即 stash 列表（ADR 0009 §2.3），
//! 以及单条 stash 的文件预览（ADR-0030）。

use std::collections::BTreeMap;

use git_core::{
    ChangedFileDto, ErrorCode, FileDiffDto, Oid, Result, StashDetailDto, StashEntryDto,
    UserVisibleError, WarningDto,
};

use super::{gix_error, tree_oid_of_commit, tree_oid_of_object, GitReadModule};
use crate::diff::{collect_changes, diff_file};
use crate::util::{find_commit, lossy, oid_from_gix, oid_from_id};

/// 单条 stash 详情最多列出的文件数；stash 通常很小，超限只可能来自海量未跟踪文件。
pub const MAX_STASH_FILES: usize = 2000;

impl GitReadModule {
    /// 本地 stash 快照：index 0 为最新；无 stash 时返回空列表。
    pub fn read_stashes(&self) -> Result<Vec<StashEntryDto>> {
        let repo = self.repo()?;
        let Ok(reference) = repo.find_reference("refs/stash") else {
            return Ok(Vec::new());
        };
        if !reference.log_exists().map_err(gix_error)? {
            return Ok(Vec::new());
        }
        let mut platform = reference.log_iter();
        let Some(lines) = platform.rev().map_err(gix_error)? else {
            return Ok(Vec::new());
        };
        let mut entries = Vec::new();
        for (index, line) in lines.enumerate() {
            let line = line.map_err(gix_error)?;
            entries.push(StashEntryDto {
                index: index as u32,
                selector: format!("stash@{{{index}}}"),
                oid: oid_from_gix(&line.new_oid),
                message: lossy(&line.message),
                created_at: line.signature.time.seconds,
            });
        }
        Ok(entries)
    }

    /// 单条 stash 的文件清单：tracked 改动取「工作区树（stash 提交树）对第 1 父」，
    /// `stash -u` 的未跟踪文件取第 3 父树的全部条目，两者按路径合并去重。
    pub fn read_stash_detail(&self, oid: &Oid) -> Result<StashDetailDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let base_tree = stash_base_tree(&repo, &parents)?;
        let stash_tree = tree_oid_of_object(&commit)?;
        let tracked = collect_changes(&repo, Some(&base_tree), Some(&stash_tree), None)?;
        let mut merged: BTreeMap<String, ChangedFileDto> = tracked
            .files
            .iter()
            .map(|change| (change.path().to_owned(), change.to_dto()))
            .collect();
        let untracked_tree = match parents.get(2) {
            Some(parent) => Some(tree_oid_of_commit(&repo, parent)?),
            None => None,
        };
        let mut untracked_truncated = false;
        if let Some(tree) = untracked_tree.as_ref() {
            let untracked = collect_changes(&repo, None, Some(tree), None)?;
            for change in &untracked.files {
                let dto = change.to_dto();
                // tracked 一侧更准确（未跟踪文件不会与第 1 父重叠），保留先到的条目。
                merged.entry(dto.path.clone()).or_insert(dto);
            }
            untracked_truncated = untracked.truncated;
        }
        let mut files: Vec<ChangedFileDto> = merged.into_values().collect();
        let mut truncated = tracked.truncated || untracked_truncated;
        if files.len() > MAX_STASH_FILES {
            files.truncate(MAX_STASH_FILES);
            truncated = true;
        }
        let mut warnings = Vec::new();
        if truncated {
            warnings.push(
                WarningDto::new(
                    "stash_files_truncated",
                    format!("stash 改动的文件过多，仅显示前 {} 个文件", files.len()),
                )
                .with_arg("n", files.len().to_string()),
            );
        }
        Ok(StashDetailDto {
            generation: self.current_generation()?,
            oid: oid.clone(),
            files,
            truncated,
            includes_untracked: untracked_tree.is_some(),
            warnings,
        })
    }

    /// 单条 stash 的单文件 diff：先按 tracked 改动查找，找不到再落到第 3 父的未跟踪文件。
    pub fn read_stash_file_diff(
        &self,
        oid: &Oid,
        path: &str,
        ignore_whitespace: bool,
    ) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let base_tree = stash_base_tree(&repo, &parents)?;
        let stash_tree = tree_oid_of_object(&commit)?;
        let tracked = diff_file(
            &repo,
            Some(&base_tree),
            Some(&stash_tree),
            path,
            ignore_whitespace,
        );
        let mut dto = match tracked {
            Ok(dto) => dto,
            Err(err) if err.code == ErrorCode::FileNotFound => {
                let Some(parent) = parents.get(2) else {
                    return Err(err);
                };
                let untracked_tree = tree_oid_of_commit(&repo, parent)?;
                diff_file(&repo, None, Some(&untracked_tree), path, ignore_whitespace)?
            }
            Err(err) => return Err(err),
        };
        dto.generation = self.current_generation()?;
        Ok(dto)
    }
}

/// stash 提交的第 1 父树（stash 前的 HEAD 树）；不是 stash 形状的提交直接拒绝。
fn stash_base_tree(repo: &gix::Repository, parents: &[Oid]) -> Result<Oid> {
    let Some(parent) = parents.first() else {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "该提交没有父提交，不是 stash 提交",
        )
        .with_key("errors.readNotAStashCommit"));
    };
    tree_oid_of_commit(repo, parent)
}
