//! merge / rebase 的 Gate 校验（ADR 0011）。

use std::collections::BTreeMap;

use git_core::{ErrorCode, GateIssueDto, Result, UserVisibleError, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::status::StatusSummary;
use crate::GitWriteModule;

/// 历史整合类 Gate 校验结果。
pub(crate) struct HistoryGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// merge / rebase 的写前检查；bare 与中断态由通用前置拒绝。
pub(crate) fn validate_history_change(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    status: &StatusSummary,
) -> Result<HistoryGateResult> {
    let branch = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
            .with_key("errors.commandMissingBranch")
    })?;
    let mut issues = Vec::new();
    let current = head
        .branch
        .clone()
        .unwrap_or_else(|| "（detached HEAD）".to_owned());

    if head.unborn {
        issues.push(issue("gate_unborn_head", "当前分支尚无提交，拒绝写操作"));
    }
    if head.detached || head.branch.is_none() {
        issues.push(issue(
            "gate_detached_head",
            "当前处于 detached HEAD，拒绝写操作",
        ));
    }
    if branch.is_empty() || branch.starts_with('-') || !module.local_branch_exists(branch)? {
        issues.push(
            issue(
                "gate_remote_branch_missing",
                format!("本地分支 {branch} 不存在"),
            )
            .with_arg("branch", branch),
        );
    } else if head.branch.as_deref() == Some(branch) {
        issues.push(issue(
            "gate_remote_branch_self",
            "不能把当前分支整合到它自己",
        ));
    }
    if status.staged > 0 || status.tracked > 0 || status.untracked > 0 || status.conflicted > 0 {
        issues.push(issue(
            "gate_remote_dirty_history",
            "工作区不干净；merge / rebase 前请先提交或 stash",
        ));
    }

    let (summary, summary_key) = match request.kind {
        WriteKind::Merge => (
            format!("将把 {branch} merge 到当前分支 {current}（--no-edit）"),
            "errors.gateSummaryMerge",
        ),
        WriteKind::Rebase => (
            format!("将把当前分支 {current} rebase 到 {branch}；可用 git rebase --abort 恢复"),
            "errors.gateSummaryRebase",
        ),
        other => unreachable!("非历史整合操作进入 history::gate: {other:?}"),
    };

    Ok(HistoryGateResult {
        issues,
        summary_args: args_map(&[("branch", branch), ("current", current.as_str())]),
        summary,
        summary_key,
    })
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
