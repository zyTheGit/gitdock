use std::collections::HashSet;

use git_core::{
    BranchGapDto, ChangedFileDto, CommitBranchContextDto, CommitDetailDto, CommitSummaryDto,
    DiffBaselineDto, ErrorCode, FileDiffDto, Oid, RefDto, RefKind, Result, UserVisibleError,
    WarningDto,
};

use super::{
    commit_summary, gix_error, reachable_set, read_head, read_refs, tree_oid_of_commit,
    tree_oid_of_object, GitReadModule, RefBadges,
};
use crate::diff::{collect_changes, diff_file};
use crate::util::{find_commit, gix_oid, lossy, oid_from_gix, oid_from_id};

/// 悬浮卡一次最多比较的本地分支数，避免大仓库里悬停时遍历过多分支历史。
const MAX_GAP_BRANCHES: usize = 6;

impl GitReadModule {
    /// commit 详情：首父/空树基线与文件列表。
    pub fn read_commit(&self, oid: &Oid) -> Result<CommitDetailDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let (baseline, baseline_note) = match parents.len() {
            0 => (DiffBaselineDto::Root, "根提交：与空树比较".to_owned()),
            1 => (DiffBaselineDto::FirstParent, "与第一父提交比较".to_owned()),
            _ => (
                DiffBaselineDto::MergeFirstParent,
                "合并提交：与第一父提交比较，不展开合并引入的其他分支差异".to_owned(),
            ),
        };
        let old_tree = match parents.first() {
            Some(parent) => Some(tree_oid_of_commit(&repo, parent)?),
            None => None,
        };
        let new_tree = Some(tree_oid_of_object(&commit)?);
        let changes = collect_changes(&repo, old_tree.as_ref(), new_tree.as_ref(), None)?;
        let files: Vec<ChangedFileDto> = changes.files.iter().map(|c| c.to_dto()).collect();
        let mut warnings = Vec::new();
        if changes.truncated {
            warnings.push(WarningDto {
                code: "diff_truncated".to_owned(),
                message: format!("变更文件过多，仅显示前 {} 个文件", files.len()),
            });
        }
        let (_, badges) = read_refs(&repo, &read_head(&repo)?)?;
        let message = lossy(commit.message_raw().map_err(gix_error)?.as_ref());
        let summary = commit_summary(&repo, oid, &badges)?;
        Ok(CommitDetailDto {
            generation: self.current_generation()?,
            commit: summary,
            message,
            parents,
            files,
            baseline,
            baseline_note,
            warnings,
        })
    }

    /// 列出包含指定 commit 的本地分支（等价 `git branch --contains`，只查 refs/heads）。
    pub fn branches_containing(&self, oid: &Oid) -> Result<Vec<String>> {
        let repo = self.repo()?;
        let target = gix_oid(oid)?;
        let _ = find_commit(&repo, oid)?;
        let mut names = Vec::new();
        for reference in repo
            .references()
            .map_err(gix_error)?
            .all()
            .map_err(gix_error)?
        {
            let mut reference = reference.map_err(gix_error)?;
            let full_name = lossy(reference.name().as_bstr());
            let Some(name) = full_name.strip_prefix("refs/heads/") else {
                continue;
            };
            let Ok(tip) = reference.peel_to_id() else {
                continue;
            };
            let mut walk = repo
                .rev_walk([tip.detach()])
                .sorting(gix::revision::walk::Sorting::BreadthFirst)
                .all()
                .map_err(gix_error)?;
            let mut contains = false;
            for entry in walk.by_ref() {
                let info = entry.map_err(gix_error)?;
                if info.id == target {
                    contains = true;
                    break;
                }
            }
            if contains {
                names.push(name.to_owned());
            }
        }
        names.sort();
        Ok(names)
    }

    /// 提交所属本地分支及相对当前 HEAD 的独有提交摘要，供图谱悬浮卡展示。
    ///
    /// 只计算本地分支；为控制耗时最多计算 [`MAX_GAP_BRANCHES`] 个分支的差异，
    /// 优先展示 tip 正好是该提交的分支，其次按 tip 提交时间倒序。
    pub fn commit_branch_context(&self, oid: &Oid, limit: usize) -> Result<CommitBranchContextDto> {
        let repo = self.repo()?;
        let _ = find_commit(&repo, oid)?;
        let head = read_head(&repo)?;
        let (refs, _) = read_refs(&repo, &head)?;
        let head_set = match &head.oid {
            Some(head_oid) => Some(reachable_set(&repo, head_oid)?),
            None => None,
        };

        let containing = self.branches_containing(oid)?;
        let mut ordered: Vec<(&RefDto, i64)> = Vec::new();
        for name in &containing {
            let reference = refs
                .iter()
                .find(|reference| {
                    reference.kind == RefKind::LocalBranch && &reference.short_name == name
                })
                .ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::Internal, "读取本地分支失败")
                        .with_detail(format!("找不到本地分支 {name}"))
                })?;
            let Some(tip) = reference.commit_oid.as_ref() else {
                continue;
            };
            let time = find_commit(&repo, tip)?
                .time()
                .map(|time| time.seconds)
                .unwrap_or(0);
            ordered.push((reference, time));
        }
        // tip 就是当前提交的分支优先，其次按最近提交时间。
        ordered.sort_by(|(left, left_time), (right, right_time)| {
            let left_is_tip = left.commit_oid.as_ref() == Some(oid);
            let right_is_tip = right.commit_oid.as_ref() == Some(oid);
            right_is_tip
                .cmp(&left_is_tip)
                .then_with(|| right_time.cmp(left_time))
                .then_with(|| left.short_name.cmp(&right.short_name))
        });

        let current = head.branch.clone();
        let mut gaps = Vec::new();
        let mut gaps_omitted = 0u32;
        for (reference, _) in &ordered {
            if current.as_deref() == Some(reference.short_name.as_str()) {
                continue;
            }
            if gaps.len() >= MAX_GAP_BRANCHES {
                gaps_omitted += 1;
                continue;
            }
            let Some(tip) = reference.commit_oid.as_ref() else {
                continue;
            };
            gaps.push(branch_gap(
                &repo,
                &reference.short_name,
                tip,
                head.oid.as_ref(),
                head_set.as_ref(),
                limit,
            )?);
        }

        Ok(CommitBranchContextDto {
            generation: self.current_generation()?,
            oid: oid.clone(),
            head: head.oid.clone(),
            current_branch: current,
            branches: containing,
            gaps,
            gaps_omitted,
        })
    }

    /// 单文件 diff：二进制、超大文件、gitlink 与编码问题均结构化降级。
    pub fn read_file_diff(&self, oid: &Oid, path: &str) -> Result<FileDiffDto> {
        let repo = self.repo()?;
        let commit = find_commit(&repo, oid)?;
        let parents: Vec<Oid> = commit.parent_ids().map(|id| oid_from_id(&id)).collect();
        let old_tree = match parents.first() {
            Some(parent) => Some(tree_oid_of_commit(&repo, parent)?),
            None => None,
        };
        let new_tree = Some(tree_oid_of_object(&commit)?);
        let mut dto = diff_file(&repo, old_tree.as_ref(), new_tree.as_ref(), path)?;
        dto.generation = self.current_generation()?;
        Ok(dto)
    }
}

/// 单个分支相对 HEAD 的差异摘要；`head_set` 为 None 表示 HEAD 尚未出生。
fn branch_gap(
    repo: &gix::Repository,
    name: &str,
    tip: &Oid,
    head_oid: Option<&Oid>,
    head_set: Option<&HashSet<Oid>>,
    limit: usize,
) -> Result<BranchGapDto> {
    let branch_set = reachable_set(repo, tip)?;
    let (branch_only, head_only) = match head_set {
        Some(set) => (
            branch_set.iter().filter(|oid| !set.contains(*oid)).count() as u32,
            set.iter().filter(|oid| !branch_set.contains(*oid)).count() as u32,
        ),
        None => (branch_set.len() as u32, 0),
    };
    let (branch_only_commits, branch_only_truncated) =
        newest_excluding(repo, tip, head_set, limit)?;
    let (head_only_commits, head_only_truncated) = match head_oid {
        Some(head) => newest_excluding(repo, head, Some(&branch_set), limit)?,
        None => (Vec::new(), false),
    };
    Ok(BranchGapDto {
        name: name.to_owned(),
        tip: tip.clone(),
        branch_only,
        head_only,
        branch_only_commits,
        branch_only_truncated,
        head_only_commits,
        head_only_truncated,
    })
}

/// 从 `from` 出发按提交时间倒序列出不在 `exclude` 中的提交，最多 `limit` 条。
fn newest_excluding(
    repo: &gix::Repository,
    from: &Oid,
    exclude: Option<&HashSet<Oid>>,
    limit: usize,
) -> Result<(Vec<CommitSummaryDto>, bool)> {
    let mut commits = Vec::new();
    let mut truncated = false;
    let walk = repo
        .rev_walk([gix_oid(from)?])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(gix_error)?;
    let badges = RefBadges::new();
    for info in walk {
        let info = info.map_err(gix_error)?;
        let oid = oid_from_gix(&info.id);
        if exclude.is_some_and(|set| set.contains(&oid)) {
            continue;
        }
        if commits.len() >= limit {
            truncated = true;
            break;
        }
        commits.push(commit_summary(repo, &oid, &badges)?);
    }
    Ok((commits, truncated))
}
