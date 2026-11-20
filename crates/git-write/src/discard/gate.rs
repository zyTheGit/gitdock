//! 丢弃未暂存改动的 Gate 校验（ADR 0026 §2.3 / §2.4）。
//!
//! 只做拒绝与报告：不碰文件系统、不执行 Git。bare 仓库与中断态由 `gate.rs` 前置拒绝，
//! 这里负责冲突索引、路径形态与「路径是否真的在未暂存/未跟踪列表里」。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, WarningDto, WriteRequest};

use crate::discard::{plan, touches_git_dir, unsafe_path_shape};
use crate::staging::{safe_rel_path, MAX_STAGING_PATHS};
use crate::status::StatusDetail;

/// 受影响文件清单上限；与 `gate.rs` 的 `MAX_AFFECTED_PATHS` 保持一致，超出部分靠
/// `affected_total` 说明。
const MAX_AFFECTED_PATHS: usize = 50;

/// 丢弃 Gate 的校验结果；`gate.rs` 把它并回 `GateReportDto`。
pub(crate) struct DiscardGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) warnings: Vec<WarningDto>,
    pub(crate) affected_paths: Vec<String>,
    pub(crate) affected_total: usize,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

pub(crate) fn validate_discard(request: &WriteRequest, detail: &StatusDetail) -> DiscardGateResult {
    let mut issues = Vec::new();
    let paths = request.paths.as_deref().unwrap_or(&[]);

    if detail.summary.conflicted > 0 {
        issues.push(
            issue(
                "gate_conflicted_index_discard",
                format!(
                    "索引中还有 {} 个未解决冲突文件；冲突内容不能丢弃，请先解决或中止当前操作",
                    detail.summary.conflicted
                ),
            )
            .with_arg("n", detail.summary.conflicted.to_string()),
        );
    }
    if paths.is_empty() {
        issues.push(issue("gate_paths_required", "请选择要丢弃的文件"));
    }
    if paths.len() > MAX_STAGING_PATHS {
        issues.push(
            issue(
                "gate_too_many_paths",
                format!("一次最多处理 {MAX_STAGING_PATHS} 个文件"),
            )
            .with_arg("max", MAX_STAGING_PATHS.to_string()),
        );
    }

    let mut accepted: Vec<String> = Vec::new();
    for path in paths {
        match classify(path, detail) {
            PathCheck::Accept => {
                if !accepted.contains(path) {
                    accepted.push(path.clone());
                }
            }
            PathCheck::NotInStatus => issues.push(
                issue(
                    "gate_path_not_in_status",
                    format!("{path} 当前没有可丢弃的改动，请刷新后重试"),
                )
                .with_arg("path", path),
            ),
            PathCheck::Reject(problem) => issues.push(problem),
        }
    }

    let plan = plan(&detail.entries, &accepted);
    let total = plan.total();
    let tracked = plan.tracked.len();
    let untracked = plan.untracked.len();
    let mut warnings = Vec::new();
    if total > 0 {
        warnings.push(
            WarningDto::new(
                "discard_destructive",
                format!(
                    "将永久丢弃 {total} 个文件的未暂存改动（已跟踪 {tracked} 个、未跟踪 {untracked} 个）；无法通过 git reflog 恢复，如需保留请先使用 Stash"
                ),
            )
            .with_arg("total", total.to_string())
            .with_arg("tracked", tracked.to_string())
            .with_arg("untracked", untracked.to_string()),
        );
    }

    DiscardGateResult {
        issues,
        warnings,
        affected_paths: accepted.iter().take(MAX_AFFECTED_PATHS).cloned().collect(),
        affected_total: accepted.len(),
        summary: if total == 0 {
            "没有可丢弃的未暂存改动".to_owned()
        } else {
            format!(
                "将永久丢弃 {total} 个文件的未暂存改动（已跟踪 {tracked} 个、未跟踪 {untracked} 个），无法通过 git reflog 恢复"
            )
        },
        summary_key: "errors.gateSummaryDiscard",
        summary_args: args_map(&[
            ("total", &total.to_string()),
            ("tracked", &tracked.to_string()),
            ("untracked", &untracked.to_string()),
        ]),
    }
}

/// 单个路径的校验结论。
enum PathCheck {
    Accept,
    /// 路径不在当前 status 中（拼写错误、过期 UI 或已被外部改动）。
    NotInStatus,
    Reject(GateIssueDto),
}

/// 按固定顺序校验单个路径；顺序决定用户看到的第一条原因。
fn classify(path: &str, detail: &StatusDetail) -> PathCheck {
    if path.ends_with('/') {
        // status 把未跟踪目录报告为 `dir/`；递归删除无法保证不碰 ignored 文件。
        return PathCheck::Reject(
            issue(
                "gate_untracked_directory",
                format!("{path} 是未跟踪目录，暂不支持整体删除，请在终端清理"),
            )
            .with_arg("path", path),
        );
    }
    if unsafe_path_shape(path) || !safe_rel_path(path) {
        return PathCheck::Reject(
            issue("gate_invalid_path", format!("路径无效：{path}")).with_arg("path", path),
        );
    }
    if touches_git_dir(path) {
        return PathCheck::Reject(
            issue(
                "gate_git_dir_path",
                format!("拒绝操作 .git 内部路径：{path}"),
            )
            .with_arg("path", path),
        );
    }
    let Some(entry) = detail.entries.iter().find(|entry| entry.path == path) else {
        return PathCheck::NotInStatus;
    };
    if entry.conflicted {
        return PathCheck::Reject(
            issue(
                "gate_conflicted_file",
                format!("{path} 存在未解决冲突，请在终端处理"),
            )
            .with_arg("path", path),
        );
    }
    if !entry.untracked && entry.worktree_code == '.' {
        return PathCheck::Reject(
            issue(
                "gate_nothing_to_discard",
                format!("{path} 没有未暂存改动（已暂存的改动需先取消暂存）"),
            )
            .with_arg("path", path),
        );
    }
    PathCheck::Accept
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
