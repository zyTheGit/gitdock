//! 分支类操作的 Gate 校验（ADR 0008 §2）。
//!
//! bare 与中断态由 gate.rs 的 `validate` 前置统一拒绝；这里只校验分支名、
//! 目标存在性与当前/其他 worktree 占用等 refs 层规则。

use std::collections::BTreeMap;

use git_core::{ErrorCode, GateIssueDto, Result, UserVisibleError, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::GitWriteModule;

/// 分支类 Gate 校验结果：`issues` 并入 Gate 报告，summary 三元组用于确认框。
pub(crate) struct RefGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// 分支创建、删除与重命名的 Gate 校验。
pub(crate) fn validate_branch_change(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let branch = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
            .with_key("errors.commandMissingBranch")
    })?;
    match request.kind {
        WriteKind::CreateBranch => validate_create(module, branch, request.oid.as_ref(), head),
        WriteKind::DeleteBranch => validate_delete(module, branch, head),
        WriteKind::RenameBranch => {
            validate_rename(module, branch, request.new_name.as_deref(), head)
        }
        other => unreachable!("非分支操作进入 branch::gate: {other:?}"),
    }
}

fn validate_create(
    module: &GitWriteModule,
    branch: &str,
    oid: Option<&git_core::Oid>,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let mut issues = Vec::new();

    if invalid_ref_name(module, "refs/heads", branch)? {
        issues.push(issue(
            "gate_invalid_branch_name",
            "分支名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
        ));
    }
    if module.local_branch_exists(branch)? {
        issues.push(
            issue("gate_branch_exists", format!("本地分支 {branch} 已存在"))
                .with_arg("branch", branch),
        );
    }

    let start = oid.map(|value| value.as_str());
    match start {
        Some(oid) => {
            if !module.commit_exists(oid)? {
                issues.push(
                    issue("gate_branch_start_invalid", "起点提交不存在或不是提交对象")
                        .with_arg("oid", oid),
                );
            }
        }
        None => {
            if head.unborn {
                issues.push(issue(
                    "gate_unborn_head_branch",
                    "当前分支尚无提交，无法作为新分支的起点",
                ));
            }
        }
    }

    let (summary, summary_args) = match start {
        Some(oid) => (
            format!("将创建本地分支 {branch}，起点提交 {}", short_oid(oid)),
            args_map(&[("branch", branch), ("oid", short_oid(oid))]),
        ),
        None => (
            format!("将基于当前 HEAD 创建本地分支 {branch}"),
            args_map(&[("branch", branch)]),
        ),
    };
    Ok(RefGateResult {
        issues,
        summary,
        summary_key: "errors.gateSummaryBranchCreate",
        summary_args,
    })
}

fn validate_delete(
    module: &GitWriteModule,
    branch: &str,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let mut issues = Vec::new();

    if !module.local_branch_exists(branch)? {
        issues.push(
            issue("gate_branch_missing", format!("本地分支 {branch} 不存在"))
                .with_arg("branch", branch),
        );
    } else {
        if head.branch.as_deref() == Some(branch) {
            issues.push(
                issue(
                    "gate_branch_current",
                    format!("不能删除当前分支 {branch}，请先切换到其他分支"),
                )
                .with_arg("branch", branch),
            );
        }
        if let Some(path) = module.worktree_owner(branch, head.branch.as_deref())? {
            issues.push(
                issue(
                    "gate_branch_checked_out",
                    format!("分支 {branch} 已被其他 worktree 占用：{path}"),
                )
                .with_arg("branch", branch)
                .with_arg("path", path),
            );
        }
    }

    Ok(RefGateResult {
        issues,
        summary: format!("将删除本地分支 {branch}；Git 只会在该分支已完全合并时执行删除"),
        summary_key: "errors.gateSummaryBranchDelete",
        summary_args: args_map(&[("branch", branch)]),
    })
}

fn validate_rename(
    module: &GitWriteModule,
    branch: &str,
    new_name: Option<&str>,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let new_name = new_name.unwrap_or("");
    let mut issues = Vec::new();

    if branch == new_name {
        issues.push(issue("gate_branch_rename_same", "新旧分支名相同"));
    }
    if invalid_ref_name(module, "refs/heads", new_name)? {
        issues.push(
            issue(
                "gate_invalid_branch_name",
                "分支名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
            )
            .with_arg("branch", new_name),
        );
    } else if module.local_branch_exists(new_name)? {
        issues.push(
            issue("gate_branch_exists", format!("本地分支 {new_name} 已存在"))
                .with_arg("branch", new_name),
        );
    }
    if !module.local_branch_exists(branch)? {
        issues.push(
            issue("gate_branch_missing", format!("本地分支 {branch} 不存在"))
                .with_arg("branch", branch),
        );
    } else if let Some(path) = module.worktree_owner(branch, head.branch.as_deref())? {
        issues.push(
            issue(
                "gate_branch_checked_out",
                format!("分支 {branch} 已被其他 worktree 占用：{path}"),
            )
            .with_arg("branch", branch)
            .with_arg("path", path),
        );
    }

    Ok(RefGateResult {
        issues,
        summary: format!("将把本地分支 {branch} 重命名为 {new_name}；如需恢复可改回原名"),
        summary_key: "errors.gateSummaryBranchRename",
        summary_args: args_map(&[("branch", branch), ("new_name", new_name)]),
    })
}

/// 用 `git check-ref-format` 校验完整引用名，并显式拒绝选项注入形态。
fn invalid_ref_name(module: &GitWriteModule, prefix: &str, name: &str) -> Result<bool> {
    if name.is_empty() || name.trim() != name || name.starts_with('-') {
        return Ok(true);
    }
    if name.chars().any(char::is_control) {
        return Ok(true);
    }
    let candidate = format!("{prefix}/{name}");
    let output = module.run_readonly(&["check-ref-format", &candidate])?;
    Ok(!output.status.success())
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

fn short_oid(oid: &str) -> &str {
    oid.get(..8).unwrap_or(oid)
}

/// 插值参数表 → BTreeMap；仅用于带参数的 i18n 模板。
fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
