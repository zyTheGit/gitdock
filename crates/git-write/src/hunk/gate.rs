//! hunk 级操作的 Gate 校验（ADR-0027）。
//!
//! 只做拒绝与报告：路径必须存在于对应侧的 status 列表，`hunk_index` 必须落在
//! 「实时 diff 的实际块数」内。块数按 Gate 时重新生成的 diff 计算，因此用户看 diff
//! 期间文件被外部改动（块数漂移）会在这里被拒绝，而不是把补丁打歪。
//! bare 仓库与中断态由 `gate.rs` 前置拒绝，这里只处理 hunk 专属条件。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, Result, WarningDto, WriteRequest};

use crate::discard::{touches_git_dir, unsafe_path_shape};
use crate::hunk::patch::{hunk_count, is_binary, is_gitlink};
use crate::hunk::{find_entry, live_diff, HunkSide};
use crate::staging::safe_rel_path;
use crate::status::StatusDetail;
use crate::GitWriteModule;

/// hunk Gate 的校验结果；`gate.rs` 把它并回 `GateReportDto`。
pub(crate) struct HunkGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

pub(crate) fn validate_hunk(
    module: &GitWriteModule,
    request: &WriteRequest,
    detail: &StatusDetail,
) -> Result<HunkGateResult> {
    let mut issues = Vec::new();
    let mut warnings = Vec::new();
    let mut affected_paths = Vec::new();
    let mut affected_total = 0usize;
    // 只有能确定动作才有意义；Gate 分派保证 kind 属于 hunk 三件套。
    let side = HunkSide::from_request(request).unwrap_or(HunkSide::Stage);
    let path = request.path.as_deref().unwrap_or_default();
    let index = request.hunk_index;
    let mut total = 0usize;
    let mut accepted = false;

    if detail.summary.conflicted > 0 {
        issues.push(
            issue(
                "gate_conflicted_index_hunk",
                format!(
                    "索引中还有 {} 个未解决冲突文件；冲突内容不能做 hunk 级操作，请先解决或中止当前操作",
                    detail.summary.conflicted
                ),
            )
            .with_arg("n", detail.summary.conflicted.to_string()),
        );
    }
    if path.is_empty() {
        issues.push(issue("gate_hunk_path_required", "缺少 hunk 的目标文件路径"));
    }
    if index.is_none() {
        issues.push(issue("gate_hunk_index_required", "缺少 hunk 序号"));
    }

    if !path.is_empty() {
        match classify(module, side, path, detail)? {
            PathCheck::Accept { hunks } => {
                total = hunks;
                affected_paths = vec![path.to_owned()];
                affected_total = 1;
                accepted = true;
            }
            PathCheck::Reject(problem) => issues.push(problem),
        }
    }
    if let Some(index) = index {
        if accepted && index as usize >= total {
            issues.push(
                issue(
                    "gate_hunk_index_out_of_range",
                    format!("hunk 序号 {index} 超出 {path} 当前的块数（{total} 块），请刷新 diff 后重试"),
                )
                .with_arg("path", path)
                .with_arg("index", index.to_string())
                .with_arg("total", total.to_string()),
            );
        }
    }

    if side == HunkSide::Discard && accepted {
        warnings.push(
            WarningDto::new(
                "hunk_discard_destructive",
                format!(
                    "将永久丢弃 {path} 工作区中的这一块改动；无法通过 git reflog 恢复，如需保留请先使用 Stash"
                ),
            )
            .with_arg("path", path),
        );
    }

    let ordinal = index.map(|value| value + 1);
    let summary = format!(
        "将{} {path} 的第 {} 块改动（共 {total} 块）",
        side.verb(),
        ordinal
            .map(|n| n.to_string())
            .unwrap_or_else(|| "?".to_owned())
    );
    let summary_key = match side {
        HunkSide::Stage => "errors.gateSummaryHunkStage",
        HunkSide::Unstage => "errors.gateSummaryHunkUnstage",
        HunkSide::Discard => "errors.gateSummaryHunkDiscard",
    };

    Ok(HunkGateResult {
        issues,
        warnings,
        affected_paths,
        affected_total,
        summary,
        summary_key,
        summary_args: args_map(&[
            ("path", path),
            ("n", &ordinal.unwrap_or(0).to_string()),
            ("total", &total.to_string()),
        ]),
    })
}

/// 路径校验结论；`Accept` 带回实时 diff 的块数。
enum PathCheck {
    Accept { hunks: usize },
    Reject(GateIssueDto),
}

/// 按固定顺序校验路径：形态 → `.git` → status 条目 → 对应侧的改动 → 实时 diff 定性。
fn classify(
    module: &GitWriteModule,
    side: HunkSide,
    path: &str,
    detail: &StatusDetail,
) -> Result<PathCheck> {
    if unsafe_path_shape(path) || !safe_rel_path(path) {
        return Ok(PathCheck::Reject(
            issue("gate_invalid_path", format!("路径无效：{path}")).with_arg("path", path),
        ));
    }
    if touches_git_dir(path) {
        return Ok(PathCheck::Reject(
            issue(
                "gate_git_dir_path",
                format!("拒绝操作 .git 内部路径：{path}"),
            )
            .with_arg("path", path),
        ));
    }
    let Some(entry) = find_entry(detail, path) else {
        return Ok(PathCheck::Reject(
            issue(
                "gate_path_not_in_status",
                format!("{path} 当前没有可处理的变更，请刷新后重试"),
            )
            .with_arg("path", path),
        ));
    };
    if entry.conflicted {
        return Ok(PathCheck::Reject(
            issue(
                "gate_conflicted_file",
                format!("{path} 存在未解决冲突，请在终端处理"),
            )
            .with_arg("path", path),
        ));
    }
    if entry.untracked {
        return Ok(PathCheck::Reject(
            issue(
                "gate_hunk_untracked",
                format!("{path} 是未跟踪文件，没有可对齐的 index 基准；请整文件暂存"),
            )
            .with_arg("path", path),
        ));
    }
    if entry.old_path.is_some() || matches!(entry.index_code, 'R' | 'C') {
        return Ok(PathCheck::Reject(
            issue(
                "gate_hunk_rename",
                format!("{path} 涉及重命名 / 复制，hunk 级操作请先在终端处理"),
            )
            .with_arg("path", path),
        ));
    }
    match side {
        HunkSide::Stage if entry.worktree_code == '.' => {
            return Ok(PathCheck::Reject(
                issue("gate_nothing_to_stage", format!("{path} 没有未暂存改动"))
                    .with_arg("path", path),
            ));
        }
        HunkSide::Unstage if entry.index_code == '.' => {
            return Ok(PathCheck::Reject(
                issue("gate_nothing_to_unstage", format!("{path} 没有已暂存改动"))
                    .with_arg("path", path),
            ));
        }
        HunkSide::Discard if entry.worktree_code == '.' => {
            return Ok(PathCheck::Reject(
                issue(
                    "gate_nothing_to_discard",
                    format!("{path} 没有未暂存改动（已暂存的改动需先取消暂存）"),
                )
                .with_arg("path", path),
            ));
        }
        _ => {}
    }

    // 最后一步才跑实时 diff：块数、二进制与 gitlink 都以它为准。
    let bytes = live_diff(module, entry, side)?;
    if is_binary(&bytes) {
        return Ok(PathCheck::Reject(
            issue(
                "gate_hunk_binary",
                format!("{path} 是二进制文件，hunk 级操作请整文件暂存或在终端处理"),
            )
            .with_arg("path", path),
        ));
    }
    if is_gitlink(&bytes) {
        return Ok(PathCheck::Reject(
            issue(
                "gate_hunk_gitlink",
                format!("{path} 是子模块（gitlink）变更，不支持 hunk 级操作"),
            )
            .with_arg("path", path),
        ));
    }
    let hunks = hunk_count(&bytes);
    if hunks == 0 {
        return Ok(PathCheck::Reject(
            issue(
                "gate_hunk_no_changes",
                format!("{path} 当前没有可操作的文本 hunk，请刷新后重试"),
            )
            .with_arg("path", path),
        ));
    }
    Ok(PathCheck::Accept { hunks })
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
