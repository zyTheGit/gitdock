//! 写操作成功文案：退出码 0 之后的 message / i18n key / 插值参数。
//!
//! 从 `execute.rs` 原样搬出（纯移动，行为不变）：execute 只保留状态机主干，
//! 文案表单独成文件，新增 WriteKind 时只改这里。

use std::collections::BTreeMap;

use git_core::{GateReportDto, Oid, PullMode, ResetMode, WriteKind, WriteRequest};

use crate::description::description_message;
use crate::interruption_outcome::args_map;
use crate::remote;

pub(crate) fn success_message(
    request: &WriteRequest,
    gate: &GateReportDto,
    head_oid: Option<&Oid>,
) -> (String, &'static str, Option<BTreeMap<String, String>>) {
    match request.kind {
        WriteKind::CherryPick => (
            "Cherry-pick 成功，图谱已刷新".to_owned(),
            "errors.outcomeCherryPickSucceeded",
            None,
        ),
        WriteKind::Revert => (
            "Revert 成功，图谱已刷新".to_owned(),
            "errors.outcomeRevertSucceeded",
            None,
        ),
        WriteKind::SwitchBranch => {
            let branch = request.branch.as_deref().unwrap_or_default();
            if gate.affected_total > 0 {
                (
                    format!(
                        "已切换到分支 {branch}，{} 个文件的工作区改动已保留",
                        gate.affected_total
                    ),
                    "errors.outcomeSwitchedWithChanges",
                    args_map(&[("branch", branch), ("n", &gate.affected_total.to_string())]),
                )
            } else {
                (
                    format!("已切换到分支 {branch}"),
                    "errors.outcomeSwitched",
                    args_map(&[("branch", branch)]),
                )
            }
        }
        WriteKind::SetBranchDescription => {
            let branch = request.branch.as_deref().unwrap_or_default();
            let removed = request
                .description
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty();
            (
                description_message(request, false),
                if removed {
                    "errors.outcomeDescriptionRemoved"
                } else {
                    "errors.outcomeDescriptionUpdated"
                },
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::StageFiles => {
            let count = request.paths.as_deref().unwrap_or(&[]).len();
            (
                format!("已暂存 {count} 个文件"),
                "errors.outcomeStaged",
                args_map(&[("n", &count.to_string())]),
            )
        }
        WriteKind::UnstageFiles => {
            let count = request.paths.as_deref().unwrap_or(&[]).len();
            (
                format!("已取消暂存 {count} 个文件"),
                "errors.outcomeUnstaged",
                args_map(&[("n", &count.to_string())]),
            )
        }
        WriteKind::CreateCommit | WriteKind::AmendCommit => {
            // spec.message_file 随函数返回 drop，临时消息文件成败均被删除。
            let short = head_oid
                .map(|oid| oid.short(8).to_owned())
                .unwrap_or_default();
            if request.kind == WriteKind::CreateCommit {
                (
                    format!("已创建提交 {short}，图谱已刷新"),
                    "errors.outcomeCommitSucceeded",
                    args_map(&[("oid", &short)]),
                )
            } else {
                (
                    format!("已修改上一条提交，新提交 {short}；原提交可经 git reflog 找回"),
                    "errors.outcomeAmendSucceeded",
                    args_map(&[("oid", &short)]),
                )
            }
        }
        WriteKind::CreateBranch => {
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已创建本地分支 {branch}，图谱已刷新"),
                "errors.outcomeBranchCreated",
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::DeleteBranch => {
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已删除本地分支 {branch}，图谱已刷新"),
                "errors.outcomeBranchDeleted",
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::DeleteBranchRemote => {
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已删除远程分支 origin/{branch}，图谱已刷新"),
                "errors.outcomeBranchRemoteDeleted",
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::DeleteTagRemote => {
            let tag = request.branch.as_deref().unwrap_or_default();
            (
                format!("已删除远程标签 {tag}，图谱已刷新"),
                "errors.outcomeTagRemoteDeleted",
                args_map(&[("tag", tag)]),
            )
        }
        WriteKind::RenameBranch => {
            let branch = request.branch.as_deref().unwrap_or_default();
            let new_name = request.new_name.as_deref().unwrap_or_default();
            (
                format!("已将本地分支 {branch} 重命名为 {new_name}，图谱已刷新"),
                "errors.outcomeBranchRenamed",
                args_map(&[("branch", branch), ("new_name", new_name)]),
            )
        }
        WriteKind::CreateTag => {
            let tag = request.branch.as_deref().unwrap_or_default();
            (
                format!("已创建本地标签 {tag}，图谱已刷新"),
                "errors.outcomeTagCreated",
                args_map(&[("tag", tag)]),
            )
        }
        WriteKind::DeleteTag => {
            let tag = request.branch.as_deref().unwrap_or_default();
            (
                format!("已删除本地标签 {tag}，图谱已刷新"),
                "errors.outcomeTagDeleted",
                args_map(&[("tag", tag)]),
            )
        }
        WriteKind::SetTagDescription => {
            let tag = request.branch.as_deref().unwrap_or_default();
            let cleared = request
                .description
                .as_deref()
                .unwrap_or("")
                .trim()
                .is_empty();
            (
                if cleared {
                    format!("已清除标签 {tag} 的附注描述，改为轻量标签")
                } else {
                    format!("已更新标签 {tag} 的附注描述")
                },
                if cleared {
                    "errors.outcomeTagDescriptionCleared"
                } else {
                    "errors.outcomeTagDescriptionUpdated"
                },
                args_map(&[("tag", tag)]),
            )
        }
        WriteKind::StashSave => (
            "已保存当前工作区改动为 stash".to_owned(),
            "errors.outcomeStashSaved",
            None,
        ),
        WriteKind::StashApply => {
            let selector = request.stash.as_deref().unwrap_or_default();
            (
                format!("已应用 {selector}，条目保留"),
                "errors.outcomeStashApplied",
                args_map(&[("selector", selector)]),
            )
        }
        WriteKind::StashPop => {
            let selector = request.stash.as_deref().unwrap_or_default();
            (
                format!("已应用并移除 {selector}"),
                "errors.outcomeStashPopped",
                args_map(&[("selector", selector)]),
            )
        }
        WriteKind::StashDrop => {
            let selector = request.stash.as_deref().unwrap_or_default();
            (
                format!("已删除 stash 条目 {selector}"),
                "errors.outcomeStashDropped",
                args_map(&[("selector", selector)]),
            )
        }
        WriteKind::Fetch => (
            "已 fetch 远程更新，图谱已刷新".to_owned(),
            "errors.outcomeFetchSucceeded",
            None,
        ),
        WriteKind::FetchPrune => (
            "已 fetch 远程更新，并清理远端已删除分支的本地远程跟踪引用".to_owned(),
            "errors.outcomeFetchPruned",
            None,
        ),
        WriteKind::CheckoutRemoteBranch => {
            let remote_branch = request.branch.as_deref().unwrap_or_default();
            let local = remote::local_branch_name(remote_branch, request.new_name.as_deref());
            (
                if gate.affected_total > 0 {
                    format!(
                        "已把远程分支 {remote_branch} 检出为本地分支 {local}（跟踪 {remote_branch}），{} 个文件的工作区改动已保留",
                        gate.affected_total
                    )
                } else {
                    format!("已把远程分支 {remote_branch} 检出为本地分支 {local}（跟踪 {remote_branch}）")
                },
                "errors.outcomeCheckedOutRemoteBranch",
                args_map(&[("branch", remote_branch), ("local", local)]),
            )
        }
        WriteKind::PushSetUpstream => {
            let branch = request.branch.as_deref().unwrap_or_default();
            // Gate 已按 ADR-0028 策略选定 remote 并写进 summary_args，文案与实际命令保持一致。
            let remote = gate_arg(gate, "remote");
            (
                if remote.is_empty() {
                    format!("已推送 {branch}，并建立上游")
                } else {
                    format!("已推送 {branch}，并建立上游 {remote}/{branch}")
                },
                "errors.outcomePushUpstreamSet",
                args_map(&[
                    ("branch", branch),
                    ("remote", &remote),
                    ("upstream", &format!("{remote}/{branch}")),
                ]),
            )
        }
        WriteKind::PushTag => {
            let tag = request.branch.as_deref().unwrap_or_default();
            let remote = gate_arg(gate, "remote");
            (
                format!("已推送标签 {tag} 到远程 {remote}"),
                "errors.outcomeTagPushed",
                args_map(&[("tag", tag), ("remote", &remote)]),
            )
        }
        WriteKind::Pull => {
            let mode = request.pull_mode.unwrap_or(PullMode::FfOnly);
            (
                match mode {
                    PullMode::FfOnly => "已拉取并快进当前分支，工作区已刷新",
                    PullMode::Merge => "已拉取并合并远端更新，工作区已刷新",
                    PullMode::Rebase => "已拉取并将当前分支 rebase 到远端",
                }
                .to_owned(),
                "errors.outcomePullSucceeded",
                None,
            )
        }
        WriteKind::Push => (
            "已推送当前分支".to_owned(),
            "errors.outcomePushSucceeded",
            None,
        ),
        WriteKind::Merge => {
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已把 {branch} merge 到当前分支"),
                "errors.outcomeMergeSucceeded",
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::Rebase => {
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已把当前分支 rebase 到 {branch}"),
                "errors.outcomeRebaseSucceeded",
                args_map(&[("branch", branch)]),
            )
        }
        WriteKind::ContinueOperation | WriteKind::AbortOperation => (
            "操作已完成，图谱已刷新".to_owned(),
            "errors.outcomeCompleted",
            None,
        ),
        // 正常路径已在 execute 入口委托给 discard 模块；此处仅为枚举完备性兜底。
        WriteKind::DiscardFiles => (
            "已丢弃所选文件的未暂存改动".to_owned(),
            "errors.outcomeDiscarded",
            None,
        ),
        // hunk 三件套（ADR 0027）：序号对用户展示为 1 起始的「第 n 块」。
        WriteKind::StageHunk => {
            let (path, ordinal) = hunk_target(request);
            (
                format!("已暂存 {path} 的第 {ordinal} 块改动"),
                "errors.outcomeHunkStaged",
                args_map(&[("path", path), ("n", &ordinal)]),
            )
        }
        WriteKind::UnstageHunk => {
            let (path, ordinal) = hunk_target(request);
            (
                format!("已取消暂存 {path} 的第 {ordinal} 块改动"),
                "errors.outcomeHunkUnstaged",
                args_map(&[("path", path), ("n", &ordinal)]),
            )
        }
        WriteKind::DiscardHunk => {
            let (path, ordinal) = hunk_target(request);
            (
                format!("已丢弃 {path} 的第 {ordinal} 块改动"),
                "errors.outcomeHunkDiscarded",
                args_map(&[("path", path), ("n", &ordinal)]),
            )
        }
        // 重置（ADR-0029）：三种模式各自的文案；目标短 OID 同时作为参数回传。
        WriteKind::Reset => {
            let short = request
                .oid
                .as_ref()
                .map(|oid| oid.short(8).to_owned())
                .unwrap_or_default();
            let mode = request.reset_mode.unwrap_or(ResetMode::Mixed);
            (
                match mode {
                    ResetMode::Soft => {
                        format!("已 soft 重置到 {short}：分支指针已回退，暂存区与工作区改动全部保留")
                    }
                    ResetMode::Mixed => format!(
                        "已 mixed 重置到 {short}：分支指针已回退，原暂存改动已退回工作区未暂存"
                    ),
                    ResetMode::Hard => format!(
                        "已 hard 重置到 {short}：分支指针、暂存区与已跟踪改动均已回退；原提交可经 Reflog 找回"
                    ),
                },
                match mode {
                    ResetMode::Soft => "errors.outcomeResetSoft",
                    ResetMode::Mixed => "errors.outcomeResetMixed",
                    ResetMode::Hard => "errors.outcomeResetHard",
                },
                args_map(&[("oid", short.as_str()), ("mode", mode.as_str())]),
            )
        }
        // 冲突解决（ADR-0033）：checkout 只改工作区、索引仍是冲突条目，文案必须说明这点。
        WriteKind::ResolveConflictOurs => {
            let path = request.path.as_deref().unwrap_or_default();
            (
                format!(
                    "已用所选一侧（ours）的内容覆盖 {path}；该文件仍未暂存，确认后请标记为已解决"
                ),
                "errors.resolveConflictOursDone",
                args_map(&[("path", path)]),
            )
        }
        WriteKind::ResolveConflictTheirs => {
            let path = request.path.as_deref().unwrap_or_default();
            (
                format!(
                    "已用所选一侧（theirs）的内容覆盖 {path}；该文件仍未暂存，确认后请标记为已解决"
                ),
                "errors.resolveConflictTheirsDone",
                args_map(&[("path", path)]),
            )
        }
        WriteKind::MarkConflictResolved => {
            let path = request.path.as_deref().unwrap_or_default();
            (
                format!("已把 {path} 标记为已解决"),
                "errors.markConflictResolvedDone",
                args_map(&[("path", path)]),
            )
        }
        // worktree 管理（ADR-0034）：成功文案由 worktree 模块执行后调用本表。
        WriteKind::CreateWorktree => {
            let path = request.path.as_deref().unwrap_or_default();
            let branch = request.branch.as_deref().unwrap_or_default();
            (
                format!("已在 {path} 创建 worktree，检出分支 {branch}"),
                "errors.worktreeCreated",
                args_map(&[("path", path), ("branch", branch)]),
            )
        }
        WriteKind::RemoveWorktree => {
            let path = request.path.as_deref().unwrap_or_default();
            (
                format!("已移除 worktree {path}"),
                "errors.worktreeRemoved",
                args_map(&[("path", path)]),
            )
        }
    }
}

/// 读取 Gate summary_args 中的字符串参数；缺失时为空串。
fn gate_arg(gate: &GateReportDto, key: &str) -> String {
    gate.summary_args
        .as_ref()
        .and_then(|args| args.get(key))
        .cloned()
        .unwrap_or_default()
}

/// hunk 文案的（路径, 1 起始序号）；Gate 已校验，缺字段时按空值与 0 兜底。
fn hunk_target(request: &WriteRequest) -> (&str, String) {
    let path = request.path.as_deref().unwrap_or_default();
    let ordinal = request.hunk_index.map(|value| value + 1).unwrap_or(0);
    (path, ordinal.to_string())
}
