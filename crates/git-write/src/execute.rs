//! 执行状态机：运行白名单命令并按退出码与操作态判定结果。

use std::collections::BTreeMap;
use std::io::Write;
use std::process::Stdio;

use git_core::{
    git_command, lossy_text as text, ErrorCode, Result, UserVisibleError, WriteKind,
    WriteOutcomeDto, WriteRequest, WriteStatus,
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
        let mut command = git_command();
        command
            .current_dir(&self.root)
            .args(&spec.args)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_TERMINAL_PROMPT", "0");
        let output = if let Some(stdin) = spec.stdin {
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command.spawn().map_err(|e| {
                UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                    .with_key("errors.commandSpawnFailed")
                    .with_detail(e.to_string())
            })?;
            let write_result = child
                .stdin
                .take()
                .map(|mut pipe| pipe.write_all(&stdin))
                .unwrap_or(Ok(()));
            if let Err(err) = write_result {
                let _ = child.kill();
                let _ = child.wait();
                return Err(UserVisibleError::new(
                    ErrorCode::GitCommandFailed,
                    "无法向 git 写入路径列表",
                )
                .with_key("errors.outcomeStdinWriteFailed")
                .with_detail(err.to_string()));
            }
            child.wait_with_output().map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "等待 git 命令结束失败")
                    .with_key("errors.outcomeWaitFailed")
                    .with_detail(e.to_string())
            })?
        } else {
            command.output().map_err(|e| {
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
            let (action, marker) = interruption_command(request)?;
            let continuing = request.kind == WriteKind::ContinueOperation;
            let marker_present = self.marker_exists(marker);
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
                (
                    format!(
                        "继续 {action} 后结果为空（{marker} 仍然存在）。请在终端执行 git cherry-pick --skip 或 git revert --skip 跳过该提交；本应用不会自动跳过"
                    ),
                    "errors.outcomeContinueEmpty",
                    args_map(&[("action", action), ("marker", marker)]),
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

        let (message, key) = if request.kind == WriteKind::SwitchBranch {
            (
                "切换被 Git 拒绝，未执行 stash / reset / clean；请根据诊断信息处理（提交、暂存或在终端处理）后重试",
                "errors.outcomeSwitchRejected",
            )
        } else {
            ("Git 拒绝了本次操作", "errors.outcomeGitRejected")
        };
        Ok(WriteOutcomeDto {
            key: Some(key.into()),
            args: None,
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
