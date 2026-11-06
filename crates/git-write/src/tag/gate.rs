//! 本地标签操作的 Gate 校验（ADR 0008 §2）。

use std::collections::BTreeMap;

use git_core::{ErrorCode, GateIssueDto, Result, UserVisibleError, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::GitWriteModule;

use super::validate_description;

/// 标签类 Gate 校验结果：`issues` 并入 Gate 报告，summary 三元组用于确认框。
pub(crate) struct RefGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// 标签创建与删除的 Gate 校验。
pub(crate) fn validate_tag_change(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let tag = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少标签名")
            .with_key("errors.commandMissingTag")
    })?;
    match request.kind {
        WriteKind::CreateTag => validate_create(module, tag, request, head),
        WriteKind::DeleteTag => validate_delete(module, tag),
        WriteKind::SetTagDescription => validate_set_description(module, tag, request),
        other => unreachable!("非标签操作进入 tag::gate: {other:?}"),
    }
}

fn validate_create(
    module: &GitWriteModule,
    tag: &str,
    request: &WriteRequest,
    head: &HeadInfo,
) -> Result<RefGateResult> {
    let mut issues = Vec::new();

    if invalid_tag_name(module, tag)? {
        issues.push(issue(
            "gate_invalid_tag_name",
            "标签名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
        ));
    }
    if module.tag_exists(tag)? {
        issues
            .push(issue("gate_tag_exists", format!("本地标签 {tag} 已存在")).with_arg("tag", tag));
    }

    let target = request
        .oid
        .as_ref()
        .map(|value| value.as_str().to_owned())
        .unwrap_or_else(|| "HEAD".to_owned());
    if request.oid.is_some() && !module.commit_exists(&target)? {
        issues.push(
            issue("gate_tag_target_invalid", "标签目标不存在或不是提交对象")
                .with_arg("oid", &target),
        );
    } else if head.unborn {
        issues.push(issue(
            "gate_unborn_head_tag",
            "当前分支尚无提交，无法创建标签",
        ));
    }

    let annotated = !request.message.as_deref().unwrap_or("").trim().is_empty();
    let short = request
        .oid
        .as_ref()
        .map(|value| short_oid(value.as_str()).to_owned())
        .unwrap_or_else(|| "HEAD".to_owned());
    let summary = if annotated {
        format!("将创建附注标签 {tag} 指向 {short}")
    } else {
        format!("将创建轻量标签 {tag} 指向 {short}")
    };
    Ok(RefGateResult {
        issues,
        summary,
        summary_key: if annotated {
            "errors.gateSummaryTagCreateAnnotated"
        } else {
            "errors.gateSummaryTagCreate"
        },
        summary_args: args_map(&[("tag", tag), ("oid", &short)]),
    })
}

fn validate_delete(module: &GitWriteModule, tag: &str) -> Result<RefGateResult> {
    let mut issues = Vec::new();

    if !module.tag_exists(tag)? {
        issues
            .push(issue("gate_tag_missing", format!("本地标签 {tag} 不存在")).with_arg("tag", tag));
    }

    Ok(RefGateResult {
        issues,
        summary: format!("将删除本地标签 {tag}；不会删除远程同名标签"),
        summary_key: "errors.gateSummaryTagDelete",
        summary_args: args_map(&[("tag", tag)]),
    })
}

/// 标签描述对应附注消息：标签必须存在且可 peel 到提交，写入值非空时校验字符。
fn validate_set_description(
    module: &GitWriteModule,
    tag: &str,
    request: &WriteRequest,
) -> Result<RefGateResult> {
    let mut issues = Vec::new();

    if !module.tag_exists(tag)? {
        issues
            .push(issue("gate_tag_missing", format!("本地标签 {tag} 不存在")).with_arg("tag", tag));
    } else if !module.commit_exists(&format!("refs/tags/{tag}"))? {
        issues.push(
            issue(
                "gate_tag_not_commit",
                format!("标签 {tag} 未指向提交对象，无法把附注消息作为描述"),
            )
            .with_arg("tag", tag),
        );
    }

    let description = request.description.as_deref().unwrap_or("");
    validate_description(description)?;
    let cleared = description.trim().is_empty();

    Ok(RefGateResult {
        issues,
        summary: if cleared {
            format!("将清除标签 {tag} 的附注描述，并把标签改为轻量标签")
        } else {
            format!("将重写标签 {tag} 的附注描述（标签对象会重建）")
        },
        summary_key: if cleared {
            "errors.gateSummaryTagDescriptionCleared"
        } else {
            "errors.gateSummaryTagDescription"
        },
        summary_args: args_map(&[("tag", tag)]),
    })
}

fn invalid_tag_name(module: &GitWriteModule, tag: &str) -> Result<bool> {
    if tag.is_empty() || tag.trim() != tag || tag.starts_with('-') {
        return Ok(true);
    }
    if tag.chars().any(char::is_control) {
        return Ok(true);
    }
    let candidate = format!("refs/tags/{tag}");
    let output = module.run_readonly(&["check-ref-format", &candidate])?;
    Ok(!output.status.success())
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

fn short_oid(oid: &str) -> &str {
    oid.get(..8).unwrap_or(oid)
}

fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
