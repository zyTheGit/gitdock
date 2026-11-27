//! 中断态恢复/中止（cherry-pick / revert / merge / rebase --continue / --abort）的 Gate 校验与摘要。

use std::collections::BTreeMap;

use git_core::{GateIssueDto, InterruptionKind, WriteKind};

use crate::gate::{args_map, issue};
use crate::GitWriteModule;

pub(crate) fn validate_and_summarize(
    module: &GitWriteModule,
    kind: WriteKind,
    interruption: Option<InterruptionKind>,
    conflicted: u32,
    issues: &mut Vec<GateIssueDto>,
) -> (String, &'static str, Option<BTreeMap<String, String>>) {
    let continuing = kind == WriteKind::ContinueOperation;
    let verb = if continuing { "继续" } else { "中止" };
    let verb_name = if continuing { "continue" } else { "abort" };
    let pick = match interruption {
        Some(InterruptionKind::CherryPick) => Some(("cherry-pick", vec!["CHERRY_PICK_HEAD"])),
        Some(InterruptionKind::Revert) => Some(("revert", vec!["REVERT_HEAD"])),
        Some(InterruptionKind::Merge) => Some(("merge", vec!["MERGE_HEAD"])),
        Some(InterruptionKind::Rebase) => Some((
            "rebase",
            vec!["REBASE_HEAD", "rebase-merge", "rebase-apply"],
        )),
        Some(_) => {
            issues.push(issue(
                "gate_interruption_invalid",
                "继续/中止只支持 cherry-pick、revert、merge 或 rebase 中断",
            ));
            None
        }
        None => {
            issues.push(
                issue(
                    "gate_interruption_required",
                    format!("{verb}操作需要指定中断类型（cherry_pick、revert、merge 或 rebase）"),
                )
                .with_arg("verb", verb_name),
            );
            None
        }
    };
    let mut summary = format!("无法{verb}当前操作");
    let mut summary_key = if continuing {
        "errors.gateSummaryContinueUnavailable"
    } else {
        "errors.gateSummaryAbortUnavailable"
    };
    let mut summary_args: Option<BTreeMap<String, String>> = None;
    if let Some((action, markers)) = pick {
        let all_markers = [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "REBASE_HEAD",
            "rebase-merge",
            "rebase-apply",
        ];
        // 标记必须严格匹配：磁盘上出现了请求类型之外的标记即拒绝。
        if let Some(other_marker) = all_markers
            .iter()
            .find(|marker| !markers.contains(marker) && module.marker_exists(marker))
        {
            issues.push(
                issue(
                    "gate_interruption_mismatch",
                    format!("请求的是 {action} 中断，但检测到其他操作的中断标记（{other_marker}）"),
                )
                .with_arg("action", action)
                .with_arg("marker", *other_marker),
            );
        } else if !markers.iter().any(|marker| module.marker_exists(marker)) {
            issues.push(
                issue(
                    "gate_interruption_marker_absent",
                    format!(
                        "未检测到 {}，当前没有可{verb}的 {action} 操作",
                        markers.join(" / ")
                    ),
                )
                .with_arg("marker", markers.join(" / "))
                .with_arg("action", action)
                .with_arg("verb", verb_name),
            );
        }
        if module.marker_exists("index.lock") {
            issues.push(issue(
                "gate_index_locked",
                "index.lock 被占用，请等待其他 Git 进程结束后重试；本应用不会删除锁文件",
            ));
        }
        if continuing && conflicted > 0 {
            issues.push(
                issue(
                    "gate_unresolved_conflicts",
                    format!(
                        "还有 {conflicted} 个文件存在未解决冲突，请先解决冲突并 git add 后再继续"
                    ),
                )
                .with_arg("n", conflicted.to_string()),
            );
        }
        if continuing {
            summary = format!("将执行 git {action} --continue，完成当前 {action} 操作");
            summary_key = "errors.gateSummaryContinue";
            summary_args = args_map(&[("action", action)]);
        } else {
            summary = format!(
                "将执行 git {action} --abort，回到操作开始前的状态；已手工解决的冲突内容会丢失"
            );
            summary_key = "errors.gateSummaryAbort";
            summary_args = args_map(&[("action", action)]);
        }
    }
    (summary, summary_key, summary_args)
}
