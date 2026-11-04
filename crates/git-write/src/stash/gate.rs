//! stash 操作的 Gate 校验（ADR 0009 §2.4）。

use std::collections::BTreeMap;

use git_core::{ErrorCode, GateIssueDto, Result, UserVisibleError, WriteKind, WriteRequest};

use crate::stash::parse_selector;
use crate::status::StatusSummary;
use crate::GitWriteModule;

/// stash 类 Gate 校验结果。
pub(crate) struct StashGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// save 与 apply/pop/drop 的 Gate 分发。
pub(crate) fn validate_stash_change(
    module: &GitWriteModule,
    request: &WriteRequest,
    status: &StatusSummary,
) -> Result<StashGateResult> {
    match request.kind {
        WriteKind::StashSave => validate_save(request, status),
        WriteKind::StashApply | WriteKind::StashPop | WriteKind::StashDrop => {
            validate_existing(module, request)
        }
        other => unreachable!("非 stash 操作进入 stash::gate: {other:?}"),
    }
}

fn validate_save(request: &WriteRequest, status: &StatusSummary) -> Result<StashGateResult> {
    let include_untracked = request.include_untracked.unwrap_or(false);
    let has_tracked = status.staged > 0 || status.tracked > 0;
    let has_untracked = status.untracked > 0;
    let mut issues = Vec::new();

    if !has_tracked && !has_untracked {
        issues.push(issue("gate_stash_nothing", "工作区没有可保存的改动"));
    } else if !has_tracked && has_untracked && !include_untracked {
        issues.push(issue(
            "gate_stash_untracked_only",
            "当前只有未跟踪文件；如需一并保存，请勾选「包含未跟踪文件」",
        ));
    }

    let summary = if include_untracked {
        "将保存当前工作区改动为 stash（包含未跟踪文件）"
    } else {
        "将保存当前工作区改动为 stash"
    };
    Ok(StashGateResult {
        issues,
        summary: summary.to_owned(),
        summary_key: "errors.gateSummaryStashSave",
        summary_args: args_map(&[(
            "untracked",
            if include_untracked { "true" } else { "false" },
        )]),
    })
}

fn validate_existing(module: &GitWriteModule, request: &WriteRequest) -> Result<StashGateResult> {
    let selector = request.stash.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少 stash 选择器")
            .with_key("errors.commandMissingStash")
    })?;
    let mut issues = Vec::new();

    match parse_selector(selector) {
        None => issues.push(
            issue(
                "gate_stash_selector_invalid",
                "stash 选择器必须形如 stash@{N}",
            )
            .with_arg("selector", selector),
        ),
        Some(index) => {
            if index >= module.stash_count()? {
                issues.push(
                    issue(
                        "gate_stash_not_found",
                        format!("stash 条目 {selector} 不存在，请刷新列表后重试"),
                    )
                    .with_arg("selector", selector),
                );
            }
        }
    }

    let (summary, summary_key) = match request.kind {
        WriteKind::StashApply => (
            format!("将应用 {selector}，条目保留"),
            "errors.gateSummaryStashApply",
        ),
        WriteKind::StashPop => (
            format!("将应用 {selector} 并从列表移除（成功后条目删除）"),
            "errors.gateSummaryStashPop",
        ),
        WriteKind::StashDrop => (
            format!("将删除 {selector}（破坏性操作）"),
            "errors.gateSummaryStashDrop",
        ),
        other => unreachable!("非 stash 操作进入 stash::gate: {other:?}"),
    };
    Ok(StashGateResult {
        issues,
        summary,
        summary_key,
        summary_args: args_map(&[("selector", selector)]),
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
