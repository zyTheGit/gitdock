//! 写域 command：写前校验、执行、中断检测与暂存区/分支描述读取。

use std::sync::Arc;

use git_core::{
    BranchDescriptionDto, FileDiffDto, GateReportDto, InterruptionDto, Result, StagingStatusDto,
    WorkspaceStatusDto, WriteOutcomeDto, WriteRequest,
};
use refresh::RefreshReason;
use tauri::State;

use super::{blocking, Shared};
use crate::app::logging;

#[tauri::command]
pub async fn validate_write(
    state: State<'_, Shared>,
    request: WriteRequest,
) -> Result<GateReportDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.validate(&request))).await
}

/// 执行写操作。完成后重新探测 generation 与 HEAD，供前端判断是否刷新。
#[tauri::command]
pub async fn execute_write(
    state: State<'_, Shared>,
    request: WriteRequest,
) -> Result<WriteOutcomeDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        // 写互斥按仓库生效：整段写操作与写后刷新都固定在发起写的标签上，
        // 即使中途切换了活动标签，也不会把这次的变更记到别的仓库。
        let entry = state.active_entry()?;
        let outcome = state.with_entry(Some(entry.id), |entry| {
            let mut outcome = entry.session.write.execute(&request)?;
            match entry.session.read.state() {
                Ok(repo) => {
                    outcome.generation = Some(repo.generation);
                    outcome.head_oid = repo.head.oid;
                }
                Err(err) => {
                    logging::warn(&format!("写操作后重新探测仓库状态失败：{err}"));
                }
            }
            Ok(outcome)
        })?;
        logging::info(&format!(
            "写操作 {:?} 执行完成，状态 {:?}",
            request.kind, outcome.status
        ));
        // 写操作强制失效：先登记新代际，避免监听线程对同一变化重复通知。
        if let Some(generation) = outcome.generation {
            state.request_refresh_for(entry.id, RefreshReason::Write);
            state.observe_generation_for(entry.id, generation);
            state.accept_generation_for(entry.id, generation);
        }
        Ok(outcome)
    })
    .await
}

#[tauri::command]
pub async fn inspect_interruption(state: State<'_, Shared>) -> Result<InterruptionDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.inspect_interruption())).await
}

#[tauri::command]
pub async fn workspace_status(state: State<'_, Shared>) -> Result<WorkspaceStatusDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.workspace_status())).await
}

/// 暂存区按 HEAD/Index/Worktree 读取；generation 取当前仓库会话，前端据此丢弃过期响应。
#[tauri::command]
pub async fn staging_status(state: State<'_, Shared>) -> Result<StagingStatusDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            let mut dto = session.write.staging_status()?;
            dto.generation = session.read.current_generation()?;
            Ok(dto)
        })
    })
    .await
}

/// 暂存区单文件 diff；`ignore_whitespace` 只影响展示，不参与 hunk 定位（ADR-0030）。
#[tauri::command]
pub async fn read_staging_diff(
    state: State<'_, Shared>,
    path: String,
    staged: bool,
    ignore_whitespace: Option<bool>,
) -> Result<FileDiffDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let ignore_whitespace = ignore_whitespace.unwrap_or(false);
        state.with_session(|session| {
            let mut dto = session
                .write
                .staging_file_diff(&path, staged, ignore_whitespace)?;
            dto.generation = session.read.current_generation()?;
            Ok(dto)
        })
    })
    .await
}

#[tauri::command]
pub async fn read_branch_description(
    state: State<'_, Shared>,
    branch: String,
) -> Result<BranchDescriptionDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.read_branch_description(&branch)))
        .await
}
