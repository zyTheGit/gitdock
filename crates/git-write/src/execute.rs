//! 执行状态机：运行白名单命令并按退出码与操作态判定结果。

use git_core::{
    lossy_text as text, run_git_output, run_git_with_stdin, ErrorCode, Result, UserVisibleError,
    WriteKind, WriteOutcomeDto, WriteRequest, WriteStatus,
};

use crate::description::description_message;
use crate::interruption_outcome::{args_map, stderr_option};
use crate::remote::failure::remote_failure;
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

        if let Some(outcome) =
            crate::interruption_outcome::interruption_outcome(self, request, exit_code, &stderr)?
        {
            return Ok(outcome);
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
            WriteKind::Fetch
                | WriteKind::Pull
                | WriteKind::Push
                | WriteKind::DeleteBranchRemote
                | WriteKind::DeleteTagRemote
        ) {
            let (message, key) = remote_failure(request.kind, &stderr).unwrap_or((
                "远程操作失败，请检查网络与远端配置",
                "errors.outcomeRemoteFailed",
            ));
            // 远端引用已不存在：删除目标已达成，按成功收尾；前端不再停在失败提示上。
            let remote_ref_missing = key == "errors.outcomeRemoteRefMissing"
                || key == "errors.outcomeRemoteTagRefMissing";
            let arg_name = if request.kind == WriteKind::DeleteTagRemote {
                "tag"
            } else {
                "branch"
            };
            return Ok(WriteOutcomeDto {
                key: Some(key.into()),
                args: if remote_ref_missing {
                    args_map(&[(arg_name, request.branch.as_deref().unwrap_or_default())])
                } else {
                    None
                },
                status: if remote_ref_missing {
                    WriteStatus::Succeeded
                } else {
                    WriteStatus::Failed
                },
                message: message.to_owned(),
                exit_code,
                stderr: if remote_ref_missing {
                    None
                } else {
                    stderr_option(&stderr)
                },
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
