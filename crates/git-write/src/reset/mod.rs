//! 本地重置 `git reset --soft|--mixed|--hard <oid>`（ADR-0029）。
//!
//! 本模块只做三件事：把 `reset_mode` 映射为参数数组里的显式开关（Git CLI 知识留在
//! git-write，不进 git-core）、按当前 status 汇总「硬重置会波及哪些文件」、以及提示
//! 目标落后于上游时本地与远端将分叉。
//!
//! 边界：重置本身是一条 Git 命令，复用 `execute` 的单命令管线（不新增 Tauri command）；
//! reflog 由 Git 自动写入，本模块不读也不写 reflog；不提供 `--keep` / `--merge` / 多选重置。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

use git_core::{ErrorCode, Oid, ResetMode, Result, UserVisibleError, WriteRequest};

use crate::status::StatusDetail;

/// 重置模式对应的命令行开关。
pub(crate) fn mode_flag(mode: ResetMode) -> &'static str {
    match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    }
}

/// `reset` 必须显式给出模式：缺省等于「不知道用户想保留什么」，不能替用户猜。
pub(crate) fn require_mode(request: &WriteRequest) -> Result<ResetMode> {
    request.reset_mode.ok_or_else(|| {
        UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "缺少重置模式（soft / mixed / hard）",
        )
        .with_key("errors.resetModeRequired")
    })
}

/// 目标提交必填；Gate 已拒绝缺失，这里只做执行期兜底。
pub(crate) fn require_target(request: &WriteRequest) -> Result<&Oid> {
    request.oid.as_ref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
            .with_key("errors.commandMissingOid")
    })
}

/// `git reset --<mode> <oid>`：OID 是完整十六进制，不会构成选项注入。
pub(crate) fn reset_args(mode: ResetMode, oid: &Oid) -> Vec<String> {
    vec![
        "reset".to_owned(),
        mode_flag(mode).to_owned(),
        oid.to_string(),
    ]
}

/// 硬重置波及的路径与分项计数（已暂存 / 已修改 / 未跟踪）。
///
/// 计数按状态侧统计，同一文件既有暂存又有工作区改动时两侧各计一次；`paths` 去重后
/// 的长度即 `affected_total`，因此 `affected_total` 可能小于三个计数之和。
pub(crate) struct WorkingTreeImpact {
    pub(crate) paths: Vec<String>,
    pub(crate) staged: usize,
    pub(crate) tracked: usize,
    pub(crate) untracked: usize,
}

impl WorkingTreeImpact {
    pub(crate) fn total(&self) -> usize {
        self.paths.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.paths.is_empty()
    }
}

/// 按当前 status 汇总会被硬重置波及的路径；冲突条目不计（Gate 已拒绝冲突索引）。
pub(crate) fn working_tree_impact(detail: &StatusDetail) -> WorkingTreeImpact {
    let mut impact = WorkingTreeImpact {
        paths: Vec::new(),
        staged: 0,
        tracked: 0,
        untracked: 0,
    };
    for entry in &detail.entries {
        if entry.conflicted {
            continue;
        }
        let hit = if entry.untracked {
            impact.untracked += 1;
            true
        } else {
            let staged = entry.index_code != '.';
            let tracked = entry.worktree_code != '.';
            impact.staged += usize::from(staged);
            impact.tracked += usize::from(tracked);
            staged || tracked
        };
        if hit && !impact.paths.contains(&entry.path) {
            impact.paths.push(entry.path.clone());
        }
    }
    impact
}
