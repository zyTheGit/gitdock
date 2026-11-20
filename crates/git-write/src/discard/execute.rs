//! 丢弃未暂存改动的执行（ADR 0026 §2.5）。
//!
//! 两段：已跟踪路径先 `git restore --worktree`（索引不动，已暂存内容保留），成功后
//! 逐条删除未跟踪文件。任一步失败即返回 `Failed`，已完成的删除不回滚。

use std::path::Path;

use git_core::{
    lossy_text as text, run_git_with_stdin, ErrorCode, Result, UserVisibleError, WriteOutcomeDto,
    WriteRequest, WriteStatus,
};

use crate::discard::{nul_pathspec, plan, restore_args, touches_git_dir};
use crate::interruption_outcome::{args_map, stderr_option};
use crate::GitWriteModule;

pub(crate) fn execute_discard(
    module: &GitWriteModule,
    request: &WriteRequest,
) -> Result<WriteOutcomeDto> {
    let detail = module.status_detail()?;
    let paths = request.paths.as_deref().unwrap_or(&[]);
    let plan = plan(&detail.entries, paths);

    if !plan.tracked.is_empty() {
        let args = restore_args();
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let stdin = nul_pathspec(&plan.tracked);
        // 与其他写操作一致：禁用交互式编辑器与终端提示，全部经 git-core seam 执行并记录日志。
        let envs = [
            ("GIT_EDITOR", "true"),
            ("GIT_SEQUENCE_EDITOR", "true"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ];
        let output =
            run_git_with_stdin(Some(module.root()), &arg_refs, &envs, &stdin).map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "执行 git restore 失败")
                    .with_key("errors.outcomeWaitFailed")
                    .with_detail(e.to_string())
            })?;
        if !output.status.success() {
            let stderr_text = text(&output.stderr);
            return Ok(failed(
                module,
                "丢弃未暂存改动被 Git 拒绝，工作区内容保持不变".to_owned(),
                "errors.outcomeDiscardRejected",
                stderr_option(&stderr_text),
            ));
        }
    }

    let mut removed = 0usize;
    for path in &plan.untracked {
        // TOCTOU 兜底：路径必须仍是未跟踪条目，避免过期 UI 删掉已被 Git 跟踪的文件。
        if !detail
            .entries
            .iter()
            .any(|entry| entry.untracked && entry.path == *path)
        {
            return Ok(failed(
                module,
                format!("{path} 已不在未跟踪列表，请刷新后重试"),
                "errors.outcomeDiscardRejected",
                None,
            ));
        }
        if let Err(err) = remove_untracked(module.root(), path) {
            return Ok(failed(
                module,
                format!(
                    "删除未跟踪文件 {path} 失败；本次已删除 {removed} 个文件，已完成的删除不回滚"
                ),
                "errors.outcomeDiscardFailed",
                err.detail.or(Some(err.message)),
            ));
        }
        removed += 1;
    }

    let tracked = plan.tracked.len();
    let total = plan.total();
    Ok(WriteOutcomeDto {
        key: Some("errors.outcomeDiscarded".into()),
        args: args_map(&[
            ("total", &total.to_string()),
            ("tracked", &tracked.to_string()),
            ("untracked", &removed.to_string()),
        ]),
        status: WriteStatus::Succeeded,
        message: format!(
            "已丢弃 {total} 个文件的未暂存改动（回退已跟踪 {tracked} 个、删除未跟踪 {removed} 个）"
        ),
        exit_code: None,
        stderr: None,
        conflict_files: Vec::new(),
        interruption: Some(module.inspect_interruption()?),
        generation: None,
        head_oid: module.head_oid().ok(),
    })
}

/// 未跟踪路径的文件系统删除：父目录规范化后必须仍在仓库内，且只删文件或符号链接本身。
pub(crate) fn remove_untracked(root: &Path, path: &str) -> Result<()> {
    let invalid = |detail: String| {
        UserVisibleError::new(ErrorCode::Io, format!("无法删除未跟踪文件 {path}"))
            .with_key("errors.discardRemoveFailed")
            .with_arg("path", path)
            .with_detail(detail)
    };
    if touches_git_dir(path) {
        return Err(invalid(".git 内部路径一律拒绝".to_owned()));
    }
    let target = root.join(path);
    let parent = target
        .parent()
        .ok_or_else(|| invalid("路径没有父目录".to_owned()))?;
    let parent =
        std::fs::canonicalize(parent).map_err(|e| invalid(format!("父目录不可解析：{e}")))?;
    if !parent.starts_with(root) {
        return Err(invalid(format!("目标越出仓库根目录：{}", parent.display())));
    }
    // symlink_metadata 不跟随链接：删除符号链接只移除链接本身，不会波及仓库外目标。
    let meta = std::fs::symlink_metadata(&target).map_err(|e| invalid(format!("读取失败：{e}")))?;
    if meta.is_dir() {
        return Err(invalid("未跟踪目录不支持整体删除".to_owned()));
    }
    std::fs::remove_file(&target).map_err(|e| invalid(format!("删除失败：{e}")))
}

fn failed(
    module: &GitWriteModule,
    message: String,
    key: &str,
    stderr: Option<String>,
) -> WriteOutcomeDto {
    WriteOutcomeDto {
        key: Some(key.to_owned()),
        args: None,
        status: WriteStatus::Failed,
        message,
        exit_code: None,
        stderr,
        conflict_files: Vec::new(),
        interruption: module.inspect_interruption().ok(),
        generation: None,
        head_oid: module.head_oid().ok(),
    }
}
