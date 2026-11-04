//! 提交创建与 amend 的 Gate 校验（ADR 0007 §2.2）。
//!
//! bare 与中断态由 gate.rs 的 `validate` 前置统一拒绝，这里不重复；
//! 其余规则按 ADR 表格落地：空暂存拒绝 create、空消息拒绝、冲突索引拒绝、
//! unborn HEAD 拒绝 amend（create 允许首次提交）。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, Result, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::status::StatusSummary;
use crate::GitWriteModule;

/// 提交类 Gate 校验结果：`issues` 并入 Gate 报告，summary 三元组用于确认框。
pub(crate) struct CommitGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// 提交类操作的 Gate 校验。issues 非空即拒绝执行；amend 的 summary 展示将被替换
/// 的 HEAD 提交（历史改写必须专门确认）。
pub(crate) fn validate_commit(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    status: &StatusSummary,
) -> Result<CommitGateResult> {
    let amend = request.kind == WriteKind::AmendCommit;
    let mut issues = Vec::new();

    if request.message.as_deref().unwrap_or("").trim().is_empty() {
        issues.push(GateIssueDto::new("gate_empty_message", "提交消息不能为空"));
    }
    // 暂存区为空：create 拒绝；amend 允许（只改消息）。
    if !amend && status.staged == 0 {
        issues.push(GateIssueDto::new(
            "gate_nothing_to_commit",
            "暂存区为空，没有可提交的内容；如需修改上一条提交请用 amend",
        ));
    }
    // unborn HEAD：create 允许（首提交）；amend 拒绝。
    if amend && head.unborn {
        issues.push(GateIssueDto::new(
            "gate_unborn_head_amend",
            "当前分支尚无提交，没有可修改的 HEAD 提交",
        ));
    }
    if status.conflicted > 0 {
        issues.push(
            GateIssueDto::new(
                "gate_conflicted_index_commit",
                format!(
                    "存在 {} 个未解决的冲突文件，请先解决并暂存后再提交",
                    status.conflicted
                ),
            )
            .with_arg("n", status.conflicted.to_string()),
        );
    }

    let (summary, summary_key, summary_args) = if amend {
        amend_summary(module, head)
    } else {
        (
            format!("将创建提交（{} 个文件的变更已暂存）", status.staged),
            "errors.gateSummaryCommit",
            args_map(&[("n", &status.staged.to_string())]),
        )
    };
    Ok(CommitGateResult {
        issues,
        summary,
        summary_key,
        summary_args,
    })
}

/// amend 摘要：展示将被替换的 HEAD 提交（短 oid + 主题）与「提交标识会改变」说明；
/// unborn 或读取失败时无 HEAD 可展示，退回不可用文案（Gate 已拒绝，不阻断报告）。
fn amend_summary(
    module: &GitWriteModule,
    head: &HeadInfo,
) -> (String, &'static str, Option<BTreeMap<String, String>>) {
    match (head.unborn, module.head_commit_summary()) {
        (false, Some((short_oid, subject))) => (
            format!(
                "将用新提交替换 HEAD 提交 {short_oid}（{subject}）；提交标识会改变，原提交可经 git reflog 找回"
            ),
            "errors.gateSummaryAmend",
            args_map(&[("oid", &short_oid), ("subject", &subject)]),
        ),
        _ => (
            "无法修改 HEAD 提交".to_owned(),
            "errors.gateSummaryAmendUnavailable",
            None,
        ),
    }
}

/// 插值参数表 → BTreeMap；与 gate.rs 的 args_map 语义一致。
fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
