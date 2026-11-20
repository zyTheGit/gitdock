//! 仓库会话域 command：启动传参、标签页打开/切换/关闭与会话状态读取（ADR-0032）。
//!
//! 所有读写 command 仍缺省作用于活动标签；标签本身由四个 command 管理。

use std::sync::Arc;

use git_core::{RepoStateDto, Result};
use tauri::State;

use super::{blocking, Shared};
use crate::app::state::{RepoId, RepoListDto, RepoRestoreDto};

#[tauri::command]
pub fn startup_repository() -> Option<String> {
    // F1 启动传参：取第一个非选项参数，路径校验与打开交给 open_repository。
    std::env::args_os()
        .skip(1)
        .find(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(|arg| arg.to_string_lossy().into_owned())
}

/// 打开或激活仓库标签；成功后成为活动仓库。标签数不设上限。
#[tauri::command]
pub async fn open_repository(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    path: String,
) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || state.open_repository(&app, &path)).await
}

/// 启动恢复：一次登记全部标签，只为活动仓库返回完整状态（ADR-0036）。
#[tauri::command]
pub async fn restore_repositories(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    paths: Vec<String>,
    active: Option<String>,
) -> Result<RepoRestoreDto> {
    let state = Arc::clone(&state);
    blocking(move || state.restore_repositories(&app, paths, active)).await
}

/// 启动恢复与标签栏初始化的唯一来源；顺序按打开时间。
#[tauri::command]
pub async fn list_repositories(state: State<'_, Shared>) -> Result<RepoListDto> {
    let state = Arc::clone(&state);
    blocking(move || state.list_repositories()).await
}

/// 切换活动标签；未知 id 返回 `repository_not_found`。
#[tauri::command]
pub async fn activate_repository(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    repo_id: RepoId,
) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || state.activate_repository(&app, repo_id)).await
}

/// 关闭标签；`repo_id` 缺省（None）时关闭活动仓库。
/// 返回接替成为活动仓库的状态；没有剩余标签时返回 `None`。
#[tauri::command]
pub async fn close_repository(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    repo_id: Option<RepoId>,
) -> Result<Option<RepoStateDto>> {
    let state = Arc::clone(&state);
    blocking(move || state.close_repository(&app, repo_id)).await
}

#[tauri::command]
pub async fn repository_state(state: State<'_, Shared>) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            let mut dto = session.read.state()?;
            // 刷新与写前 Gate 必须是同一中断检测来源，否则写后横幅滞后一整个操作。
            dto.interruption = session.write.inspect_interruption()?;
            Ok(dto)
        })
    })
    .await
}
