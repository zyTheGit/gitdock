//! worktree 创建/移除的执行（ADR-0034）。
//!
//! Gate 已通过；命令以参数数组启动、路径在参数末位、不拼 shell。成功文案统一由
//! `outcome.rs` 给出；失败不重试、不使用 `--force`，只把 Git 的 stderr 作为诊断透传。

use git_core::{
    lossy_text as text, run_git_output, ErrorCode, GateReportDto, Result, UserVisibleError,
    WriteKind, WriteOutcomeDto, WriteRequest, WriteStatus,
};

use crate::GitWriteModule;

pub(crate) fn execute(
    module: &GitWriteModule,
    request: &WriteRequest,
    gate: &GateReportDto,
) -> Result<WriteOutcomeDto> {
    let args = crate::worktree::args_for(request)?;
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_git_output(Some(module.root()), &args, &[("GIT_TERMINAL_PROMPT", "0")])
        .map_err(|error| {
            UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                .with_key("errors.commandSpawnFailed")
                .with_detail(error.to_string())
        })?;
    let exit_code = output.status.code();
    let stderr = text(&output.stderr);
    let head_oid = module.head_oid().ok();

    if exit_code == Some(0) {
        let (message, key, args) =
            crate::outcome::success_message(request, gate, head_oid.as_ref());
        return Ok(WriteOutcomeDto {
            key: Some(key.into()),
            args,
            status: WriteStatus::Succeeded,
            message,
            exit_code,
            stderr: None,
            conflict_files: Vec::new(),
            interruption: Some(module.inspect_interruption()?),
            generation: None,
            head_oid,
        });
    }

    let message = match request.kind {
        WriteKind::CreateWorktree => {
            "创建 worktree 被 Git 拒绝（目标目录不可用或分支已被检出）；请按诊断信息处理后重试"
        }
        _ => {
            "移除 worktree 被 Git 拒绝（worktree 可能仍有未提交改动）；本应用不会使用 --force，请在终端处理"
        }
    };
    Ok(WriteOutcomeDto {
        key: Some("errors.outcomeWorktreeRejected".into()),
        args: None,
        status: WriteStatus::Failed,
        message: message.to_owned(),
        exit_code,
        stderr: Some(stderr),
        conflict_files: Vec::new(),
        interruption: Some(module.inspect_interruption()?),
        generation: None,
        head_oid,
    })
}
