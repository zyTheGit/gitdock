//! reset 的 Gate 校验（ADR-0029）。
//!
//! 拒绝：缺模式 / 缺目标、unborn HEAD、目标无法解析为 commit、冲突索引、
//! 目标就是 HEAD 且该模式无实际效果。
//! 放行但报告（warning）：硬重置的受影响路径与计数、目标落后于上游时的分叉提示。
//! bare 仓库与中断态由 `gate.rs` 前置拒绝，这里只处理 reset 专属条件。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, ResetMode, Result, WarningDto, WriteRequest};

use crate::command::HeadInfo;
use crate::reset::working_tree_impact;
use crate::status::StatusDetail;
use crate::GitWriteModule;

/// 受影响文件清单上限；与 `discard/gate.rs` 保持一致，超出部分靠 `affected_total` 说明。
const MAX_AFFECTED_PATHS: usize = 50;

/// reset Gate 的校验结果；`gate.rs` 把它并回 `GateReportDto`。
pub(crate) struct ResetGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

pub(crate) fn validate_reset(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    detail: &StatusDetail,
) -> Result<ResetGateResult> {
    let mut issues = Vec::new();
    let mut warnings = Vec::new();
    let mut affected_paths = Vec::new();
    let mut affected_total = 0usize;

    let mode = request.reset_mode;
    let oid = request.oid.as_ref();
    let short = oid.map(|oid| oid.short(8).to_owned()).unwrap_or_default();

    if mode.is_none() {
        issues.push(issue(
            "gate_reset_mode_required",
            "请选择重置模式（soft / mixed / hard）",
        ));
    }
    if head.unborn {
        issues.push(issue("gate_unborn_head", "当前分支尚无提交，无法重置"));
    }
    if detail.summary.conflicted > 0 {
        issues.push(
            issue(
                "gate_conflicted_index_reset",
                format!(
                    "索引中还有 {} 个未解决冲突文件，请先解决或中止当前操作后再重置",
                    detail.summary.conflicted
                ),
            )
            .with_arg("n", detail.summary.conflicted.to_string()),
        );
    }

    // 目标必须是已存在的 commit：树 / blob / 不存在的 OID 一律拒绝，不在执行阶段才报错。
    let mut target_ok = false;
    match oid {
        None => issues.push(issue("gate_reset_target_required", "缺少重置的目标提交")),
        Some(oid) => {
            if module.commit_exists(oid.as_str())? {
                target_ok = true;
            } else {
                issues.push(
                    issue(
                        "gate_reset_target_invalid",
                        format!("{short} 不存在或不是提交，无法重置"),
                    )
                    .with_arg("oid", &short),
                );
            }
        }
    }

    // 目标就是 HEAD 时判断该模式是否还有实际效果：没有就明确拒绝，而不是假装成功。
    let target_is_head = target_ok
        && !head.unborn
        && module
            .head_oid()
            .map(|current| Some(&current) == oid)
            .unwrap_or(false);
    if let (Some(mode), true) = (mode, target_is_head) {
        // soft 只移动指针，指针本来就在目标上；mixed / hard 还取决于索引与工作区是否有内容。
        let nothing_to_do = match mode {
            ResetMode::Soft => true,
            ResetMode::Mixed => detail.summary.staged == 0,
            ResetMode::Hard => detail.summary.staged == 0 && detail.summary.tracked == 0,
        };
        if nothing_to_do {
            issues.push(
                issue(
                    "gate_reset_noop",
                    format!(
                        "目标 {short} 就是当前 HEAD，{} 模式没有可重置的内容",
                        mode.as_str()
                    ),
                )
                .with_arg("oid", &short)
                .with_arg("mode", mode.as_str()),
            );
        }
    }

    // 硬重置会丢弃已暂存与已跟踪改动；未跟踪文件不受影响，但一并列出以免用户误以为安全。
    if mode.is_some_and(ResetMode::is_destructive) {
        let impact = working_tree_impact(detail);
        if !impact.is_empty() {
            let total = impact.total();
            affected_total = total;
            affected_paths = impact
                .paths
                .iter()
                .take(MAX_AFFECTED_PATHS)
                .cloned()
                .collect();
            warnings.push(
                WarningDto::new(
                    "reset_hard_destructive",
                    format!(
                        "硬重置将永久丢弃 {total} 个文件的暂存与工作区改动（已暂存 {}、已修改 {}）；\
                         未跟踪文件 {} 个不会被删除。未提交改动无法通过 Reflog 恢复",
                        impact.staged, impact.tracked, impact.untracked
                    ),
                )
                .with_arg("oid", &short)
                .with_arg("total", total.to_string())
                .with_arg("staged", impact.staged.to_string())
                .with_arg("tracked", impact.tracked.to_string())
                .with_arg("untracked", impact.untracked.to_string()),
            );
        }
    }

    // 目标落在上游历史之外的分支侧（本地已分叉）：不阻断，只提示。
    if target_ok && !head.unborn && !target_is_head {
        if let Some(upstream) = module.upstream()? {
            if let Some(warning) = diverges_warning(module, oid, &short, &upstream)? {
                warnings.push(warning);
            }
        }
    }

    let branch = head.branch.as_deref().unwrap_or("HEAD");
    let mode_name = mode.map(ResetMode::as_str).unwrap_or_default();
    let summary = match mode {
        Some(ResetMode::Soft) => format!(
            "将把 {branch} 重置到 {short}（soft：分支指针回退，暂存区与工作区改动全部保留）"
        ),
        Some(ResetMode::Mixed) => format!(
            "将把 {branch} 重置到 {short}（mixed：分支指针回退并清空暂存区，工作区改动保留为未暂存）"
        ),
        Some(ResetMode::Hard) => format!(
            "将把 {branch} 重置到 {short}（hard：分支指针回退，并永久丢弃 {affected_total} 个文件的暂存与已跟踪改动）"
        ),
        None => "无法确定重置模式".to_owned(),
    };

    Ok(ResetGateResult {
        issues,
        warnings,
        affected_paths,
        affected_total,
        summary,
        summary_key: "errors.gateSummaryReset",
        summary_args: args_map(&[
            ("mode", mode_name),
            ("oid", &short),
            ("branch", branch),
            ("total", &affected_total.to_string()),
        ]),
    })
}

/// 目标是否落后于上游：`target` 在上游历史上、而上游不在 `target` 历史上，
/// 即「重置后本地分支会退到远端之前」，被丢弃的提交已经推送过。
///
/// 判定用两条只读 `git merge-base --is-ancestor`；任一侧无法判定时返回 None（不提示）。
fn diverges_warning(
    module: &GitWriteModule,
    oid: Option<&git_core::Oid>,
    short: &str,
    upstream: &str,
) -> Result<Option<WarningDto>> {
    let Some(oid) = oid else {
        return Ok(None);
    };
    let target_in_upstream = module.is_ancestor(oid.as_str(), upstream)?;
    if target_in_upstream != Some(true) {
        return Ok(None);
    }
    if module.is_ancestor(upstream, oid.as_str())? == Some(true) {
        return Ok(None);
    }
    Ok(Some(
        WarningDto::new(
            "reset_diverges_upstream",
            format!(
                "目标 {short} 落后于上游 {upstream}：重置会丢弃已推送到远端的提交，本地分支将与远端分叉\
                 （远端仍保留这些提交，可 pull 或经 Reflog 找回）"
            ),
        )
        .with_arg("oid", short)
        .with_arg("upstream", upstream),
    ))
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
