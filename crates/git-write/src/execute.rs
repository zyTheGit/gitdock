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

        // 丢弃未暂存改动 = `git restore --worktree` + 未跟踪路径逐条删除（ADR 0026）；
        // 纯未跟踪请求不产生 git 命令，因此不进入下面的单命令管线。
        if request.kind == WriteKind::DiscardFiles {
            return crate::discard::execute::execute_discard(self, request);
        }

        // hunk 级操作（ADR 0027）：补丁由 hunk 模块按实时 diff 重建后经 stdin 交给
        // `git apply`，成功文案仍由 outcome.rs 统一给出。
        if matches!(
            request.kind,
            WriteKind::StageHunk | WriteKind::UnstageHunk | WriteKind::DiscardHunk
        ) {
            return crate::hunk::execute::execute_hunk(self, request, &gate);
        }

        // worktree 创建/移除（ADR-0034）：命令构造与结果判定都在 worktree 模块。
        if matches!(
            request.kind,
            WriteKind::CreateWorktree | WriteKind::RemoveWorktree
        ) {
            return crate::worktree::execute::execute(self, request, &gate);
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
            let (message, key, args) =
                crate::outcome::success_message(request, &gate, head_oid.as_ref());
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
                | WriteKind::FetchPrune
                | WriteKind::Pull
                | WriteKind::Push
                | WriteKind::PushSetUpstream
                | WriteKind::PushTag
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
            WriteKind::CheckoutRemoteBranch => (
                "检出远程分支被 Git 拒绝（本地分支可能已创建但未切换），未执行 stash / reset / clean；请根据诊断信息处理",
                "errors.outcomeCheckoutRemoteRejected",
                args_map(&[("branch", request.branch.as_deref().unwrap_or_default())]),
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
            WriteKind::Reset => {
                // 重置非零退出时分支指针未移动（Git 先校验再动引用），结果按失败报告。
                let oid = request
                    .oid
                    .as_ref()
                    .map(|oid| oid.short(8).to_owned())
                    .unwrap_or_default();
                let mode = request
                    .reset_mode
                    .map(|mode| mode.as_str().to_owned())
                    .unwrap_or_default();
                (
                    "重置被 Git 拒绝，未移动分支指针；请刷新后重试",
                    "errors.outcomeResetRejected",
                    args_map(&[("oid", oid.as_str()), ("mode", mode.as_str())]),
                )
            }
            WriteKind::ResolveConflictOurs
            | WriteKind::ResolveConflictTheirs
            | WriteKind::MarkConflictResolved => (
                // 工作区 / 索引可能已被外部改动；冲突状态以刷新后的 status 为准。
                "冲突处理被 Git 拒绝，工作区未按预期更新；请刷新状态后重试，或在终端处理",
                "errors.outcomeGitRejected",
                args_map(&[("path", request.path.as_deref().unwrap_or_default())]),
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
