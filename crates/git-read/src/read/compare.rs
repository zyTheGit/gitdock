use std::collections::HashSet;

use git_core::{
    ChangedFileDto, CommitSummaryDto, CompareChangeOrigin, CompareMode, CompareResultDto,
    ErrorCode, FileDiffDto, Oid, Result, UserVisibleError, WarningDto,
};

use super::{
    commit_summary, gix_error, is_worktree_ref, tree_oid_of_commit, tree_oid_of_object, FileSides,
    GitReadModule, RefBadges, DEFAULT_PAGE_LIMIT,
};
use crate::diff::{collect_changes, diff_file};
use crate::util::{find_commit, gix_oid, oid_from_gix, oid_from_id, parse_oid};

impl GitReadModule {
    /// 对比槽位解析（ADR-0030）：两侧都可以是提交 OID 或保留字 `worktree`。
    ///
    /// 工作区没有提交历史，三点模式对它没有意义，此时忽略 `two_dot`。
    pub fn compare_sides(
        &self,
        base: &str,
        compare: &str,
        path_filter: Option<&str>,
        two_dot: bool,
    ) -> Result<CompareResultDto> {
        match (is_worktree_ref(base), is_worktree_ref(compare)) {
            (true, true) => Err(worktree_both_sides()),
            (true, false) => self.compare_worktree(&parse_oid(compare)?, true, path_filter),
            (false, true) => self.compare_worktree(&parse_oid(base)?, false, path_filter),
            (false, false) => self.compare(
                &parse_oid(base)?,
                &parse_oid(compare)?,
                path_filter,
                two_dot,
            ),
        }
    }

    /// 对比中的单文件 diff；`base` / `compare` 接受 `worktree` 保留字。
    pub fn compare_sides_file_diff(
        &self,
        base: &str,
        compare: &str,
        path: &str,
        two_dot: bool,
        ignore_whitespace: bool,
    ) -> Result<FileDiffDto> {
        match (is_worktree_ref(base), is_worktree_ref(compare)) {
            (true, true) => Err(worktree_both_sides()),
            (true, false) => {
                self.compare_worktree_file_diff(&parse_oid(compare)?, true, path, ignore_whitespace)
            }
            (false, true) => {
                self.compare_worktree_file_diff(&parse_oid(base)?, false, path, ignore_whitespace)
            }
            (false, false) => self.compare_file_diff(
                &parse_oid(base)?,
                &parse_oid(compare)?,
                path,
                two_dot,
                ignore_whitespace,
            ),
        }
    }

    /// 三点对比；`two_dot` 为 true 时改为两端快照 diff，无 merge-base 时自动降级。
    pub fn compare(
        &self,
        base: &Oid,
        compare: &Oid,
        path_filter: Option<&str>,
        two_dot: bool,
    ) -> Result<CompareResultDto> {
        let repo = self.repo()?;
        let generation = self.fingerprint(&repo)?;
        let base_id = gix_oid(base)?;
        let compare_id = gix_oid(compare)?;
        let merge_base_id = repo.merge_base(base_id, compare_id).map_err(gix_error)?;
        let merge_base = merge_base_id.as_ref().map(oid_from_id);
        let merge_base_tree = match &merge_base {
            Some(mb) => Some(tree_oid_of_commit(&repo, mb)?),
            None => None,
        };
        let base_tree = tree_oid_of_commit(&repo, base)?;
        let compare_tree = tree_oid_of_commit(&repo, compare)?;
        let (old_tree, mode) = match (&merge_base_tree, two_dot) {
            (Some(_), true) => (Some(base_tree.clone()), CompareMode::TwoDot),
            (Some(mb_tree), false) => (Some(mb_tree.clone()), CompareMode::ThreeDot),
            (None, _) => (Some(base_tree.clone()), CompareMode::TwoDotFallback),
        };
        let changes = collect_changes(&repo, old_tree.as_ref(), Some(&compare_tree), path_filter)?;
        let mut files: Vec<ChangedFileDto> = changes.files.iter().map(|c| c.to_dto()).collect();

        if let Some(mb_tree) = merge_base_tree.as_ref() {
            let base_paths =
                collect_changed_paths(&repo, Some(mb_tree), Some(&base_tree), path_filter)?;
            if mode == CompareMode::ThreeDot {
                for file in &mut files {
                    file.change_origin = Some(if matches_path_set(file, &base_paths) {
                        CompareChangeOrigin::Both
                    } else {
                        CompareChangeOrigin::CompareOnly
                    });
                }
            } else {
                let compare_paths =
                    collect_changed_paths(&repo, Some(mb_tree), Some(&compare_tree), path_filter)?;
                for file in &mut files {
                    file.change_origin = match (
                        matches_path_set(file, &base_paths),
                        matches_path_set(file, &compare_paths),
                    ) {
                        (true, true) => Some(CompareChangeOrigin::Both),
                        (false, true) => Some(CompareChangeOrigin::CompareOnly),
                        (true, false) => Some(CompareChangeOrigin::BaseOnly),
                        (false, false) => None,
                    };
                }
            }
        }

        let snapshot = self.refs_snapshot(&repo, generation)?;
        let merge_base_summary = match &merge_base {
            Some(mb) => Some(commit_summary(&repo, mb, &snapshot.badges)?.summary),
            None => None,
        };
        let (compare_only, commits, commits_truncated) =
            walk_exclusive_commits(&repo, compare_id, base_id, true, &snapshot.badges)?;
        let (base_only, base_commits, base_commits_truncated) = walk_exclusive_commits(
            &repo,
            base_id,
            compare_id,
            merge_base.is_some(),
            &snapshot.badges,
        )?;
        let equivalent_commits =
            super::compare_equiv::compute_equivalent_commits(&repo, &base_commits, &commits)?;

        let mut warnings = Vec::new();
        if merge_base.is_none() {
            warnings.push(WarningDto::new(
                "no_merge_base",
                "两个引用没有共同祖先，已降级为两端快照对比",
            ));
        }
        if changes.truncated {
            warnings.push(WarningDto::new(
                "diff_truncated",
                "变更文件过多，文件列表已截断",
            ));
        }
        Ok(CompareResultDto {
            generation,
            base: base.clone(),
            compare: compare.clone(),
            merge_base,
            merge_base_summary,
            mode,
            base_only,
            compare_only,
            files,
            commits,
            commits_truncated,
            base_commits,
            base_commits_truncated,
            equivalent_commits,
            title: format!("{} → {}", base.short(7), compare.short(7)),
            warnings,
            worktree_side: None,
        })
    }

    /// 对比中的单文件 diff；`two_dot` 与列表页保持同一基线。
    pub fn compare_file_diff(
        &self,
        base: &Oid,
        compare: &Oid,
        path: &str,
        two_dot: bool,
        ignore_whitespace: bool,
    ) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        if two_dot {
            let old_tree = Some(tree_oid_of_commit(&repo, base)?);
            let new_tree = Some(tree_oid_of_commit(&repo, compare)?);
            let mut dto = diff_file(
                &repo,
                old_tree.as_ref(),
                new_tree.as_ref(),
                path,
                ignore_whitespace,
            )?;
            dto.generation = self.current_generation()?;
            return Ok(dto);
        }
        let merge_base = repo
            .merge_base(gix_oid(base)?, gix_oid(compare)?)
            .map_err(gix_error)?;
        let old_tree = match merge_base.as_ref() {
            Some(mb) => Some(tree_oid_of_commit(&repo, &oid_from_id(mb))?),
            None => Some(tree_oid_of_commit(&repo, base)?),
        };
        let new_tree = Some(tree_oid_of_commit(&repo, compare)?);
        let mut dto = diff_file(
            &repo,
            old_tree.as_ref(),
            new_tree.as_ref(),
            path,
            ignore_whitespace,
        )?;
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
            return Err(
                UserVisibleError::new(ErrorCode::InvalidArgument, "文件路径无效")
                    .with_key("errors.readInvalidFilePath"),
            );
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
            )
            .with_key("errors.readFileNotInCommit")
            .with_arg("path", path));
        }
        Ok(FileSides {
            old: old.unwrap_or_default(),
            new: new.unwrap_or_default(),
        })
    }
}

/// 统计并按最新提交序采集 `hidden..tip` 独有提交（等价 `git rev-list hidden..tip`）。
///
/// 使用 `with_hidden` 仅在分叉边界遍历，避免大仓库做全历史 `reachable_set`；
/// `collect_summaries` 为 false（如无共同祖先降级时的 base 侧）仅计数不取摘要。
fn walk_exclusive_commits(
    repo: &gix::Repository,
    tip: gix::ObjectId,
    hidden: gix::ObjectId,
    collect_summaries: bool,
    badges: &RefBadges,
) -> Result<(u32, Vec<CommitSummaryDto>, bool)> {
    let mut count = 0u32;
    let mut commits = Vec::new();
    let mut truncated = false;
    let walk = repo
        .rev_walk([tip])
        .with_hidden([hidden])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(gix_error)?;
    for info in walk {
        let info = info.map_err(gix_error)?;
        count = count.saturating_add(1);
        if collect_summaries {
            if commits.len() < DEFAULT_PAGE_LIMIT {
                let oid = oid_from_gix(&info.id);
                commits.push(commit_summary(repo, &oid, badges)?);
            } else {
                truncated = true;
            }
        }
    }
    Ok((count, commits, truncated))
}

fn collect_changed_paths(
    repo: &gix::Repository,
    old_tree: Option<&Oid>,
    new_tree: Option<&Oid>,
    path_filter: Option<&str>,
) -> Result<HashSet<String>> {
    if old_tree == new_tree {
        return Ok(HashSet::new());
    }
    let changes = collect_changes(repo, old_tree, new_tree, path_filter)?;
    let mut paths = HashSet::new();
    for change in &changes.files {
        paths.insert(change.path().to_owned());
        if let Some(old_path) = &change.old_path {
            paths.insert(old_path.clone());
        }
    }
    Ok(paths)
}

fn matches_path_set(file: &ChangedFileDto, paths: &HashSet<String>) -> bool {
    paths.contains(&file.path)
        || file
            .old_path
            .as_ref()
            .is_some_and(|old_path| paths.contains(old_path))
}

fn worktree_both_sides() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::InvalidArgument, "对比两侧不能同时是当前工作区")
        .with_key("errors.readWorktreeBothSides")
}
