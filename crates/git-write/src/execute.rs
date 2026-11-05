//! 执行状态机：运行白名单命令并按退出码与操作态判定结果。

use std::collections::BTreeMap;

use git_core::{
    lossy_text as text, run_git_output, run_git_with_stdin, ErrorCode, Result, UserVisibleError,
    WriteKind, WriteOutcomeDto, WriteRequest, WriteStatus,
};

use crate::command::interruption_command;
use crate::description::description_message;
use crate::GitWriteModule;

impl GitWriteModule {
    /// 执行白名单操作。任何非零退出后都重新探测操作态，再判定结果。
    pub fn execute(&self, request: &WriteRequest) -> Result<WriteOutcomeDto> {
        let _guard = self.write_lock.try_lock().ok_or_else(|| {
            UserVisibleError::new(ErrorCode::Internal, "已有写操作正在进行，请稍后再试")
                .with_key("errors.configSaveBusy")
        })?;

        let gate = self.validate(request)?;
        if !gate.ok {
            let issues_text = gate
                .issues
                .iter()
                .map(|issue| issue.message.as_str())
                .collect::<Vec<_>>()
                .join("；");
            return Ok(WriteOutcomeDto {
                key: Some("errors.outcomeRejected".into()),
                args: args_map(&[("issues", &issues_text)]),
                status: WriteStatus::Rejected,
                message: issues_text,
                exit_code: None,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: None,
                generation: None,
                head_oid: None,
            });
        }

        let spec = self.command_for(request)?;
        let args = spec.args.iter().map(String::as_str).collect::<Vec<_>>();
        // 环境注入：禁用交互式编辑器与终端提示（交互都在 GUI 内完成）；
        // 执行统一走 git-core seam，成功/失败进入命令执行日志。
        let envs = [
            ("GIT_EDITOR", "true"),
            ("GIT_SEQUENCE_EDITOR", "true"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ];
        let output = if let Some(stdin) = spec.stdin.as_deref() {
            // stdin 路径的 spawn、管道写入（含写失败时 kill 回收）与等待统一在
            // seam 内处理，这里只做错误包装。
            run_git_with_stdin(Some(self.root.as_path()), &args, &envs, stdin).map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "执行 git 命令失败")
                    .with_key("errors.outcomeWaitFailed")
                    .with_detail(e.to_string())
            })?
        } else {
            run_git_output(Some(self.root.as_path()), &args, &envs).map_err(|e| {
                UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                    .with_key("errors.commandSpawnFailed")
                    .with_detail(e.to_string())
            })?
        };
        let exit_code = output.status.code();
        let stderr = text(&output.stderr);
        let head_oid = self.head_oid().ok();

        if spec.description_write && exit_code == Some(5) {
            // --unset-all 在键不存在时返回 5；结果等价于空描述。
            return Ok(WriteOutcomeDto {
                key: Some("errors.outcomeDescriptionRemoved".into()),
                args: args_map(&[("branch", request.branch.as_deref().unwrap_or_default())]),
                status: WriteStatus::Succeeded,
                message: description_message(request, true),
                exit_code,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        // 继续/中止：成功必须同时满足「退出码 0」与「对应标记消失」，不做任何自动收尾。
        if matches!(
            request.kind,
            WriteKind::ContinueOperation | WriteKind::AbortOperation
        ) {
            let (action, markers) = interruption_command(request)?;
            let marker_text = markers.join(" / ");
            let continuing = request.kind == WriteKind::ContinueOperation;
            let marker_present = markers.iter().any(|marker| self.marker_exists(marker));
            if exit_code == Some(0) && !marker_present {
                let (message, key, args) = if continuing {
                    (
                        format!("已继续并完成 {action} 操作，图谱已刷新"),
                        "errors.outcomeContinueCompleted",
                        args_map(&[("action", action)]),
                    )
                } else {
                    (
                        format!("已中止 {action} 操作，已回到操作开始前的状态"),
                        "errors.outcomeAbortCompleted",
                        args_map(&[("action", action)]),
                    )
                };
                return Ok(WriteOutcomeDto {
                    key: Some(key.into()),
                    args,
                    status: WriteStatus::Succeeded,
                    message,
                    exit_code,
                    stderr: None,
                    conflict_files: Vec::new(),
                    interruption: Some(self.inspect_interruption()?),
                    generation: None,
                    head_oid,
                });
            }
            if !continuing {
                let (message, key, args) = if marker_present {
                    (
                        format!("中止 {action} 未完成，中断标记仍然存在；请在终端处理"),
                        "errors.outcomeAbortIncomplete",
                        args_map(&[("action", action)]),
                    )
                } else {
                    (
                        format!("中止 {action} 未生效，Git 返回非零退出码"),
                        "errors.outcomeAbortFailed",
                        args_map(&[("action", action)]),
                    )
                };
                return Ok(WriteOutcomeDto {
                    key: Some(key.into()),
                    args,
                    status: WriteStatus::Failed,
                    message,
                    exit_code,
                    stderr: stderr_option(&stderr),
                    conflict_files: Vec::new(),
                    interruption: Some(self.inspect_interruption()?),
                    generation: None,
                    head_oid,
                });
            }
            if !marker_present {
                // 标记已消失但退出码非零：属于 Git 的其他失败，不臆测为空提交。
                return Ok(WriteOutcomeDto {
                    key: Some("errors.outcomeContinueFailed".into()),
                    args: args_map(&[("action", action)]),
                    status: WriteStatus::Failed,
                    message: format!("继续 {action} 未完成，Git 返回非零退出码"),
                    exit_code,
                    stderr: stderr_option(&stderr),
                    conflict_files: Vec::new(),
                    interruption: Some(self.inspect_interruption()?),
                    generation: None,
                    head_oid,
                });
            }
            let status = self.status_summary()?;
            let (message, key, args, conflict_files) = if status.conflicted > 0 {
                (
                    format!(
                        "还有 {} 个文件存在未解决冲突，请解决冲突并 git add 后再继续",
                        status.conflicted
                    ),
                    "errors.outcomeUnresolvedConflicts",
                    args_map(&[("n", &status.conflicted.to_string())]),
                    status.conflicted_files,
                )
            } else {
                let hint = if action == "merge" || action == "rebase" {
                    format!("继续 {action} 未完成（{marker_text} 仍然存在）；请在终端处理")
                } else {
                    format!(
                        "继续 {action} 后结果为空（{marker_text} 仍然存在）。请在终端执行 git cherry-pick --skip 或 git revert --skip 跳过该提交；本应用不会自动跳过"
                    )
                };
                (
                    hint,
                    "errors.outcomeContinueEmpty",
                    args_map(&[("action", action), ("marker", marker_text.as_str())]),
                    Vec::new(),
                )
            };
            return Ok(WriteOutcomeDto {
                key: Some(key.into()),
                args,
                status: WriteStatus::Failed,
                message,
                exit_code,
                stderr: stderr_option(&stderr),
                conflict_files,
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        if exit_code == Some(0) {
            let (message, key, args) = match request.kind {
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
                            args_map(&[
                                ("branch", branch),
                                ("n", &gate.affected_total.to_string()),
                            ]),
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
                        .as_ref()
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
                WriteKind::Pull => {
                    let mode = request.pull_mode.unwrap_or(git_core::PullMode::FfOnly);
                    (
                        match mode {
                            git_core::PullMode::FfOnly => "已拉取并快进当前分支，工作区已刷新",
                            git_core::PullMode::Merge => "已拉取并合并远端更新，工作区已刷新",
                            git_core::PullMode::Rebase => "已拉取并将当前分支 rebase 到远端",
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
            };
            return Ok(WriteOutcomeDto {
                key: Some(key.into()),
                args,
                status: WriteStatus::Succeeded,
                message,
                exit_code,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        // 非零退出：以「操作后是否留下本次操作对应的标记」判定冲突，而不是猜 stderr。
        if matches!(request.kind, WriteKind::CherryPick | WriteKind::Revert) {
            let marker = if request.kind == WriteKind::CherryPick {
                "CHERRY_PICK_HEAD"
            } else {
                "REVERT_HEAD"
            };
            if self.marker_exists(marker) {
                let status = self.status_summary()?;
                if status.conflicted > 0 {
                    let interruption = self.inspect_interruption()?;
                    let action = if request.kind == WriteKind::CherryPick {
                        "cherry-pick"
                    } else {
                        "revert"
                    };
                    let action_label = if request.kind == WriteKind::CherryPick {
                        "Cherry-pick"
                    } else {
                        "Revert"
                    };
                    return Ok(WriteOutcomeDto {
                        key: Some("errors.outcomeConflicted".into()),
                        args: args_map(&[("action", action)]),
                        status: WriteStatus::Conflicted,
                        message: format!(
                            "{} 产生冲突，请在终端处理；本应用不会自动 abort / quit",
                            action_label
                        ),
                        exit_code,
                        stderr: Some(stderr),
                        conflict_files: status.conflicted_files,
                        interruption: Some(interruption),
                        generation: None,
                        head_oid,
                    });
                }
                if status.staged == 0 && status.tracked == 0 && status.untracked == 0 {
                    // 空 pick：状态由本应用发起，且工作区/索引干净，安全清理。
                    let skip = if request.kind == WriteKind::CherryPick {
                        "cherry-pick"
                    } else {
                        "revert"
                    };
                    let _ = self.run(&[skip, "--skip"]);
                    return Ok(WriteOutcomeDto {
                        key: Some("errors.outcomeEmptyPick".into()),
                        args: None,
                        status: WriteStatus::EmptyPick,
                        message: "无变更：该提交的内容已包含在当前分支中，已清理操作状态".into(),
                        exit_code,
                        stderr: Some(stderr),
                        conflict_files: Vec::new(),
                        interruption: Some(self.inspect_interruption()?),
                        generation: None,
                        head_oid,
                    });
                }
            }
        }

        let pull_is_rebase = request.kind == WriteKind::Pull
            && request.pull_mode == Some(git_core::PullMode::Rebase);
        let history_action = match request.kind {
            WriteKind::Merge => Some(("merge", "Merge")),
            WriteKind::Rebase => Some(("rebase", "Rebase")),
            WriteKind::Pull if request.pull_mode != Some(git_core::PullMode::FfOnly) => {
                Some(("pull", "Pull"))
            }
            _ => None,
        };
        if let Some((action, action_label)) = history_action {
            let status = self.status_summary()?;
            let markers: &[&str] = if action == "rebase" || pull_is_rebase {
                &["REBASE_HEAD", "rebase-merge", "rebase-apply"]
            } else {
                &["MERGE_HEAD"]
            };
            if status.conflicted > 0 && markers.iter().any(|marker| self.marker_exists(marker)) {
                return Ok(WriteOutcomeDto {
                    key: Some("errors.outcomeConflicted".into()),
                    args: args_map(&[("action", action)]),
                    status: WriteStatus::Conflicted,
                    message: format!(
                        "{action_label} 产生冲突，请在终端处理；本应用不会自动 abort / quit"
                    ),
                    exit_code,
                    stderr: stderr_option(&stderr),
                    conflict_files: status.conflicted_files,
                    interruption: Some(self.inspect_interruption()?),
                    generation: None,
                    head_oid,
                });
            }
        }

        if matches!(
            request.kind,
            WriteKind::Fetch | WriteKind::Pull | WriteKind::Push
        ) {
            let (message, key) = remote_failure(request.kind, &stderr).unwrap_or((
                "远程操作失败，请检查网络与远端配置",
                "errors.outcomeRemoteFailed",
            ));
            return Ok(WriteOutcomeDto {
                key: Some(key.into()),
                args: None,
                status: WriteStatus::Failed,
                message: message.to_owned(),
                exit_code,
                stderr: stderr_option(&stderr),
                conflict_files: Vec::new(),
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        // stash 应用/弹出可能产生索引冲突；stash 条目不会因此被删除。
        if matches!(request.kind, WriteKind::StashApply | WriteKind::StashPop) {
            let status = self.status_summary()?;
            if status.conflicted > 0 {
                let selector = request.stash.as_deref().unwrap_or_default();
                return Ok(WriteOutcomeDto {
                    key: Some("errors.outcomeStashConflicted".into()),
                    args: args_map(&[("selector", selector)]),
                    status: WriteStatus::Conflicted,
                    message: format!("{selector} 应用产生冲突；stash 条目保留，请解决冲突后重试"),
                    exit_code,
                    stderr: stderr_option(&stderr),
                    conflict_files: status.conflicted_files,
                    interruption: Some(self.inspect_interruption()?),
                    generation: None,
                    head_oid,
                });
            }
        }

        let (message, key, args) = match request.kind {
            WriteKind::SwitchBranch => (
                "切换被 Git 拒绝，未执行 stash / reset / clean；请根据诊断信息处理（提交、暂存或在终端处理）后重试",
                "errors.outcomeSwitchRejected",
                None,
            ),
            WriteKind::DeleteBranch => (
                "删除分支被 Git 拒绝（未完全合并的分支不会被删除）；如需强制删除，请在终端执行 git branch -D",
                "errors.outcomeBranchDeleteRejected",
                args_map(&[("branch", request.branch.as_deref().unwrap_or_default())]),
            ),
            WriteKind::StashSave
            | WriteKind::StashApply
            | WriteKind::StashPop
            | WriteKind::StashDrop => (
                "stash 操作被 Git 拒绝，请刷新列表后重试",
                "errors.outcomeStashRejected",
                request
                    .stash
                    .as_deref()
                    .map(|selector| args_map(&[("selector", selector)]))
                    .unwrap_or(None),
            ),
            _ => ("Git 拒绝了本次操作", "errors.outcomeGitRejected", None),
        };
        Ok(WriteOutcomeDto {
            key: Some(key.into()),
            args,
            status: WriteStatus::Failed,
            message: message.to_owned(),
            exit_code,
            stderr: Some(stderr),
            conflict_files: Vec::new(),
            interruption: Some(self.inspect_interruption()?),
            generation: None,
            head_oid,
        })
    }
}

/// 远程失败分类：只按 Git stderr 的稳定片段归类，不猜测具体远端。
pub(crate) fn remote_failure(
    kind: WriteKind,
    stderr: &str,
) -> Option<(&'static str, &'static str)> {
    let lower = stderr.to_lowercase();
    let auth = lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("terminal prompts disabled")
        || lower.contains("permission denied (publickey)");
    if auth {
        return Some((
            "远程认证失败；本应用不接收密码。请在内置终端完成一次 fetch/push 授权，或配置系统凭据管理器 / SSH agent 后重试",
            "errors.outcomeRemoteAuthFailed",
        ));
    }
    match kind {
        WriteKind::Pull if lower.contains("not possible to fast-forward") => Some((
            "远端有本地没有的提交，pull --ff-only 无法快进；请先 fetch，并在终端 merge/rebase（批次 5）",
            "errors.outcomePullNotFastForward",
        )),
        WriteKind::Push
            if lower.contains("non-fast-forward")
                || lower.contains("failed to push some refs")
                || lower.contains("rejected") =>
        {
            Some((
                "远端拒绝了推送（可能非快进或 hook 拒绝）；本应用不提供 force push，请在终端处理",
                "errors.outcomePushRejected",
            ))
        }
        _ => None,
    }
}

fn stderr_option(stderr: &str) -> Option<String> {
    (!stderr.trim().is_empty()).then(|| stderr.to_owned())
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
