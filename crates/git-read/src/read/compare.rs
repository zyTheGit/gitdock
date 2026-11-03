use std::collections::HashSet;

use git_core::{
    ChangedFileDto, CompareMode, CompareResultDto, ErrorCode, FileDiffDto, Oid, Result,
    UserVisibleError, WarningDto,
};

use super::{
    commit_summary, gix_error, reachable_set, read_head, read_refs, tree_oid_of_commit,
    tree_oid_of_object, FileSides, GitReadModule, DEFAULT_PAGE_LIMIT,
};
use crate::diff::{collect_changes, diff_file};
use crate::util::{find_commit, gix_oid, oid_from_gix, oid_from_id};

impl GitReadModule {
    /// 三点对比；`two_dot` 为 true 时改为两端快照 diff，无 merge-base 时自动降级。
    pub fn compare(
        &self,
        base: &Oid,
        compare: &Oid,
        path_filter: Option<&str>,
        two_dot: bool,
    ) -> Result<CompareResultDto> {
        let repo = self.repo()?;
        let base_id = gix_oid(base)?;
        let compare_id = gix_oid(compare)?;
        let merge_base_id = repo.merge_base(base_id, compare_id).map_err(gix_error)?;
        let merge_base = merge_base_id.as_ref().map(oid_from_id);
        let (old_tree, mode) = match (&merge_base, two_dot) {
            (Some(_), true) => (Some(tree_oid_of_commit(&repo, base)?), CompareMode::TwoDot),
            (Some(mb), false) => (Some(tree_oid_of_commit(&repo, mb)?), CompareMode::ThreeDot),
            (None, _) => (
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

    /// 对比中的单文件 diff；`two_dot` 与列表页保持同一基线。
    pub fn compare_file_diff(
        &self,
        base: &Oid,
        compare: &Oid,
        path: &str,
        two_dot: bool,
    ) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        if two_dot {
            let old_tree = Some(tree_oid_of_commit(&repo, base)?);
            let new_tree = Some(tree_oid_of_commit(&repo, compare)?);
            let mut dto = diff_file(&repo, old_tree.as_ref(), new_tree.as_ref(), path)?;
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
