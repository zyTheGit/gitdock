//! 冲突解决的 Gate 校验（ADR-0033 §2.3）。
//!
//! 只做拒绝与报告：bare 仓库与 `gate_interrupted` 的豁免由 `gate.rs` 处理，这里校验
//! unborn HEAD、路径形态，以及「该路径当前确实处于 conflicted」。冲突也可能来自
//! `stash apply`，因此不要求中断态；但路径必须在实时 status 的冲突清单里。
//! `mark_conflict_resolved` 额外扫描工作区文件的残留标记，命中时只给非阻断 warning。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, WarningDto, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::conflict::{find_conflict_marker, read_for_marker_scan};
use crate::discard::{touches_git_dir, unsafe_path_shape};
use crate::staging::safe_rel_path;
use crate::status::StatusDetail;
use crate::GitWriteModule;

/// 冲突 Gate 的校验结果；`gate.rs` 把它并回 `GateReportDto`。
pub(crate) struct ConflictGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

pub(crate) fn validate_conflict(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    detail: &StatusDetail,
) -> ConflictGateResult {
    let mut issues = Vec::new();
    let mut warnings = Vec::new();
    let path = request.path.as_deref().unwrap_or("");
    let mut accepted = false;

    if head.unborn {
        issues.push(issue(
            "gate_unborn_head",
            "当前分支尚无提交，不存在可解决的冲突",
        ));
    }
    match path_issue(path) {
        Some(problem) => issues.push(problem),
        None if !detail
            .summary
            .conflicted_files
            .iter()
            .any(|entry| entry == path) =>
        {
            issues.push(
                issue(
                    "gate_conflict_path_not_conflicted",
                    format!("{path} 当前不是冲突文件，请刷新后重试"),
                )
                .with_arg("path", path),
            )
        }
        None => accepted = true,
    }

    if accepted && request.kind == WriteKind::MarkConflictResolved {
        if let Some(text) = read_for_marker_scan(module.root(), path) {
            if let Some(marker) = find_conflict_marker(&text) {
                // 非阻断：前端据此要求二次确认，Gate 仍为 ok。
                warnings.push(
                    WarningDto::new(
                        "conflict_markers_present",
                        format!(
                            "{path} 仍包含冲突标记（{marker}）；标记已解决后这些标记会原样进入提交，请确认已手工处理"
                        ),
                    )
                    .with_arg("path", path)
                    .with_arg("marker", marker),
                );
            }
        }
    }

    // 摘要只描述「覆盖工作区」与「暂存」的区别，不声称哪一侧是当前分支：
    // rebase 下 ours 是上游、theirs 是正在重放的提交（ADR-0033 §3）。
    let (summary, summary_key) = match request.kind {
        WriteKind::ResolveConflictOurs => (
            format!("将用所选一侧（ours）的内容覆盖 {path} 的工作区文件；不会自动暂存"),
            "errors.gateSummaryResolveConflictOurs",
        ),
        WriteKind::ResolveConflictTheirs => (
            format!("将用所选一侧（theirs）的内容覆盖 {path} 的工作区文件；不会自动暂存"),
            "errors.gateSummaryResolveConflictTheirs",
        ),
        _ => (
            format!("将把 {path} 标记为已解决（git add）；工作区文件内容会原样暂存"),
            "errors.gateSummaryMarkConflictResolved",
        ),
    };

    let (affected_paths, affected_total) = if accepted {
        (vec![path.to_owned()], 1)
    } else {
        (Vec::new(), 0)
    };
    ConflictGateResult {
        issues,
        warnings,
        affected_paths,
        affected_total,
        summary,
        summary_key,
        summary_args: args_map(&[("path", path)]),
    }
}

/// 路径形态校验（纯函数）：空 → 缺失路径；控制字符 / 绝对路径 / 穿越 / 选项注入
/// → 无效路径；`.git` 内部路径单独拒绝。
pub(crate) fn path_issue(path: &str) -> Option<GateIssueDto> {
    if path.is_empty() {
        return Some(issue("gate_conflict_path_required", "缺少冲突文件路径"));
    }
    if path.chars().any(char::is_control) || unsafe_path_shape(path) || !safe_rel_path(path) {
        return Some(
            issue("gate_invalid_path", format!("路径无效：{path}")).with_arg("path", path),
        );
    }
    if touches_git_dir(path) {
        return Some(
            issue(
                "gate_git_dir_path",
                format!("拒绝操作 .git 内部路径：{path}"),
            )
            .with_arg("path", path),
        );
    }
    None
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
