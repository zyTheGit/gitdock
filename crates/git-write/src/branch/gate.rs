//! 分支类操作的 Gate 校验（ADR 0008 §2）。
//!
//! bare 与中断态由 gate.rs 的 `validate` 前置统一拒绝；这里只校验分支名、
//! 目标存在性与当前/其他 worktree 占用等 refs 层规则。

use std::collections::BTreeMap;

use git_core::{
    ErrorCode, GateIssueDto, Result, UserVisibleError, WarningDto, WriteKind, WriteRequest,
};

use crate::command::HeadInfo;
use crate::remote;
use crate::status::{dirty_parts, StatusDetail, StatusEntry};
use crate::GitWriteModule;

/// Gate 报告中受影响文件清单的上限；超出部分由 `affected_total` 说明。
const MAX_AFFECTED_PATHS: usize = 50;

/// 分支类 Gate 校验结果：`issues` / `warnings` / 受影响文件并入 Gate 报告，
/// summary 三元组用于确认框。
pub(crate) struct RefGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

impl RefGateResult {
    fn plain(
        issues: Vec<GateIssueDto>,
        summary: String,
        summary_key: &'static str,
        summary_args: Option<BTreeMap<String, String>>,
    ) -> Self {
        Self {
            issues,
            warnings: Vec::new(),
            affected_paths: Vec::new(),
            affected_total: 0,
            summary,
            summary_key,
            summary_args,
        }
    }
}

/// dirty / staged / untracked 的切换类 warning 与受影响文件清单（ADR-0002）。
///
/// `switch_branch` 与 `checkout_remote_branch` 共用：两者都不自动 stash / reset /
/// clean，覆盖风险交给 Git 判定。
pub(crate) struct DirtySwitchContext {
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
}

pub(crate) fn dirty_switch_context(detail: &StatusDetail) -> DirtySwitchContext {
    let status = &detail.summary;
    if status.staged == 0 && status.tracked == 0 && status.untracked == 0 {
        return DirtySwitchContext {
            warnings: Vec::new(),
            affected_paths: Vec::new(),
            affected_total: 0,
        };
    }
    let dirty_files: Vec<&StatusEntry> = detail
        .entries
        .iter()
        .filter(|entry| !entry.conflicted)
        .collect();
    let affected_total = dirty_files.len();
    let affected_paths = dirty_files
        .iter()
        .take(MAX_AFFECTED_PATHS)
        .map(|entry| entry.path.clone())
        .collect();
    DirtySwitchContext {
        warnings: vec![WarningDto::new(
            "worktree_dirty",
            format!(
                "工作区有 {affected_total} 个文件存在改动（{}）。不会自动 stash、reset 或 clean：改动会保留在工作区并可能带到目标分支；若目标分支会覆盖这些文件，Git 将拒绝切换并保持现状。",
                dirty_parts(status)
            ),
        )
        .with_arg("total", affected_total.to_string())
        .with_arg("parts", dirty_parts(status))],
        affected_paths,
        affected_total,
    }
}

/// 分支创建、删除、重命名与远程分支检出的 Gate 校验。
pub(crate) fn validate_branch_change(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    detail: &StatusDetail,
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
        WriteKind::CheckoutRemoteBranch => {
            validate_checkout_remote(module, branch, request.new_name.as_deref(), head, detail)
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
    Ok(RefGateResult::plain(
        issues,
        summary,
        "errors.gateSummaryBranchCreate",
        summary_args,
    ))
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

    Ok(RefGateResult::plain(
        issues,
        format!("将删除本地分支 {branch}；Git 只会在该分支已完全合并时执行删除"),
        "errors.gateSummaryBranchDelete",
        args_map(&[("branch", branch)]),
    ))
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

    Ok(RefGateResult::plain(
        issues,
        format!("将把本地分支 {branch} 重命名为 {new_name}；如需恢复可改回原名"),
        "errors.gateSummaryBranchRename",
        args_map(&[("branch", branch), ("new_name", new_name)]),
    ))
}

/// 检出远程跟踪分支为本地分支（ADR-0028）：切换类 Gate + 远程引用/本地名规则。
fn validate_checkout_remote(
    module: &GitWriteModule,
    remote_branch: &str,
    new_name: Option<&str>,
    head: &HeadInfo,
    detail: &StatusDetail,
) -> Result<RefGateResult> {
    let mut issues = Vec::new();
    let local = remote::local_branch_name(remote_branch, new_name);

    let remote_ref_ok =
        remote_branch.contains('/') && !invalid_ref_name(module, "refs/remotes", remote_branch)?;
    if !remote_ref_ok {
        issues.push(
            issue(
                "gate_invalid_remote_branch",
                format!("远程分支名不合法：{remote_branch}（应形如 origin/<branch>）"),
            )
            .with_arg("branch", remote_branch),
        );
    } else if !module.remote_ref_exists(&format!("refs/remotes/{remote_branch}"))? {
        issues.push(
            issue(
                "gate_remote_ref_missing",
                format!("本地没有远程跟踪引用 {remote_branch}；如远端确有该分支，请先 fetch 再试"),
            )
            .with_arg("branch", remote_branch),
        );
    }

    if invalid_ref_name(module, "refs/heads", local)? {
        issues.push(
            issue(
                "gate_invalid_branch_name",
                "本地分支名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
            )
            .with_arg("branch", local),
        );
    } else if module.local_branch_exists(local)? {
        issues.push(
            issue("gate_branch_exists", format!("本地分支 {local} 已存在"))
                .with_arg("branch", local),
        );
    }

    // 切换语义与 ADR-0002 一致：unborn / detached / 冲突索引拒绝，dirty 时 warning 放行。
    if head.unborn {
        issues.push(issue(
            "gate_unborn_head_switch",
            "当前分支尚无提交，无法切换",
        ));
    }
    if head.detached {
        issues.push(issue(
            "gate_detached_head_switch",
            "detached HEAD 状态不支持切换，请先用命令行处理",
        ));
    }
    if detail.summary.conflicted > 0 {
        issues.push(
            issue(
                "gate_conflicted_index_switch",
                format!(
                    "索引中还有 {} 个未解决冲突文件，请先在终端解决后再切换分支",
                    detail.summary.conflicted
                ),
            )
            .with_arg("n", detail.summary.conflicted.to_string()),
        );
    }
    let dirty = dirty_switch_context(detail);

    let summary = if dirty.affected_total > 0 {
        format!(
            "将把远程分支 {remote_branch} 检出为本地分支 {local} 并跟踪它；{} 个有改动的文件会保留在工作区",
            dirty.affected_total
        )
    } else {
        format!("将把远程分支 {remote_branch} 检出为本地分支 {local} 并跟踪它")
    };
    Ok(RefGateResult {
        issues,
        warnings: dirty.warnings,
        affected_paths: dirty.affected_paths,
        affected_total: dirty.affected_total,
        summary,
        summary_key: "errors.gateSummaryCheckoutRemote",
        summary_args: args_map(&[("branch", remote_branch), ("local", local)]),
    })
}

/// 用 `git check-ref-format` 校验完整引用名，并显式拒绝选项注入形态。
/// 引用名形态校验（`git check-ref-format`）；worktree 创建复用同一实现（ADR-0034）。
pub(crate) fn invalid_ref_name(module: &GitWriteModule, prefix: &str, name: &str) -> Result<bool> {
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
