//! hunk 级操作的执行（ADR-0027）。
//!
//! 一次请求 = 一条命令：重新生成实时 diff → 重新切块并复查序号 → 把「文件头 + 单块」
//! 经 stdin 喂给 `git apply`。补丁不落盘、不经过前端，非零退出按 `GitCommandFailed`
//! 返回并附 stderr，成功文案复用 `outcome::success_message`。

use git_core::{
    lossy_text as text, run_git_with_stdin, ErrorCode, GateReportDto, Result, UserVisibleError,
    WriteOutcomeDto, WriteRequest, WriteStatus,
};

use crate::hunk::{command, HunkSide};
use crate::GitWriteModule;

pub(crate) fn execute_hunk(
    module: &GitWriteModule,
    request: &WriteRequest,
    gate: &GateReportDto,
) -> Result<WriteOutcomeDto> {
    let (args, patch) = command(module, request)?;
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    // 与其它写操作一致：禁用交互式编辑器与终端提示，全部经 git-core seam 执行并记录日志。
    let envs = [
        ("GIT_EDITOR", "true"),
        ("GIT_SEQUENCE_EDITOR", "true"),
        ("GIT_TERMINAL_PROMPT", "0"),
    ];
    let output =
        run_git_with_stdin(Some(module.root()), &arg_refs, &envs, &patch).map_err(|e| {
            UserVisibleError::new(ErrorCode::GitCommandFailed, "执行 git apply 失败")
                .with_key("errors.outcomeWaitFailed")
                .with_detail(e.to_string())
        })?;
    if !output.status.success() {
        return Err(UserVisibleError::new(
            ErrorCode::GitCommandFailed,
            apply_failure_message(request),
        )
        .with_key("errors.hunkApplyFailed")
        .with_arg("path", request.path.as_deref().unwrap_or_default())
        .with_detail(text(&output.stderr)));
    }

    let head_oid = module.head_oid().ok();
    let (message, key, args) = crate::outcome::success_message(request, gate, head_oid.as_ref());
    Ok(WriteOutcomeDto {
        key: Some(key.into()),
        args,
        status: WriteStatus::Succeeded,
        message,
        exit_code: output.status.code(),
        stderr: None,
        conflict_files: Vec::new(),
        interruption: Some(module.inspect_interruption()?),
        generation: None,
        head_oid,
    })
}

fn apply_failure_message(request: &WriteRequest) -> String {
    let path = request.path.as_deref().unwrap_or_default();
    match HunkSide::from_request(request) {
        Some(HunkSide::Stage) => format!("{path} 的这块改动暂时无法暂存，请刷新 diff 后重试"),
        Some(HunkSide::Unstage) => format!("{path} 的这块改动暂时无法取消暂存，请刷新 diff 后重试"),
        Some(HunkSide::Discard) => format!("{path} 的这块改动暂时无法丢弃，请刷新 diff 后重试"),
        None => "hunk 级操作失败，请刷新 diff 后重试".to_owned(),
    }
}
