//! 继续/中止操作的结果判定（ADR 0011）：从 execute.rs 拆出的判定块与文案辅助。

use std::collections::BTreeMap;

use git_core::{Result, WriteKind, WriteOutcomeDto, WriteRequest, WriteStatus};

use crate::command::interruption_command;
use crate::GitWriteModule;

/// 继续/中止：成功必须同时满足「退出码 0」与「对应标记消失」，不做任何自动收尾。
/// 请求不是这两个操作时返回 None，交回 execute 主流程判定。
pub(crate) fn interruption_outcome(
    module: &GitWriteModule,
    request: &WriteRequest,
    exit_code: Option<i32>,
    stderr: &str,
) -> Result<Option<WriteOutcomeDto>> {
    if !matches!(
        request.kind,
        WriteKind::ContinueOperation | WriteKind::AbortOperation
    ) {
        return Ok(None);
    }
    let (action, markers) = interruption_command(request)?;
    let marker_text = markers.join(" / ");
    let continuing = request.kind == WriteKind::ContinueOperation;
    let marker_present = markers.iter().any(|marker| module.marker_exists(marker));
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
        return Ok(Some(WriteOutcomeDto {
            key: Some(key.into()),
            args,
            status: WriteStatus::Succeeded,
            message,
            exit_code,
            stderr: None,
            conflict_files: Vec::new(),
            interruption: Some(module.inspect_interruption()?),
            generation: None,
            head_oid: module.head_oid().ok(),
        }));
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
        return Ok(Some(WriteOutcomeDto {
            key: Some(key.into()),
            args,
            status: WriteStatus::Failed,
            message,
            exit_code,
            stderr: stderr_option(stderr),
            conflict_files: Vec::new(),
            interruption: Some(module.inspect_interruption()?),
            generation: None,
            head_oid: module.head_oid().ok(),
        }));
    }
    if !marker_present {
        // 标记已消失但退出码非零：属于 Git 的其他失败，不臆测为空提交。
        return Ok(Some(WriteOutcomeDto {
            key: Some("errors.outcomeContinueFailed".into()),
            args: args_map(&[("action", action)]),
            status: WriteStatus::Failed,
            message: format!("继续 {action} 未完成，Git 返回非零退出码"),
            exit_code,
            stderr: stderr_option(stderr),
            conflict_files: Vec::new(),
            interruption: Some(module.inspect_interruption()?),
            generation: None,
            head_oid: module.head_oid().ok(),
        }));
    }
    let status = module.status_summary()?;
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
    Ok(Some(WriteOutcomeDto {
        key: Some(key.into()),
        args,
        status: WriteStatus::Failed,
        message,
        exit_code,
        stderr: stderr_option(stderr),
        conflict_files,
        interruption: Some(module.inspect_interruption()?),
        generation: None,
        head_oid: module.head_oid().ok(),
    }))
}

/// 插值参数表 → BTreeMap；仅用于带参数的 i18n 模板。
pub(crate) fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}

/// 非空 stderr 才返回 Some；空输出不展示。
pub(crate) fn stderr_option(stderr: &str) -> Option<String> {
    (!stderr.trim().is_empty()).then(|| stderr.to_owned())
}
