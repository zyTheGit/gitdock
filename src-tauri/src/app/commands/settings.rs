//! 设置域 command：应用设置读写、最近仓库与 Git 配置。

use std::path::PathBuf;
use std::sync::Arc;

use git_core::Result;
use git_write::config::{ConfigEntryDto, ConfigScope, GitConfigDto};
use tauri::State;

use super::{blocking, Shared};
use crate::app::config::SettingsDto;
use crate::app::state::AppState;

#[tauri::command]
pub async fn load_settings(state: State<'_, Shared>) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.settings()).await
}

#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    settings: SettingsDto,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let saved = state.save_settings(settings)?;
        // 监听开关随设置即时生效；仅当仓库已打开时重启。
        if let Ok(repo) = state.with_session(|session| Ok(session.read.path().to_path_buf())) {
            state.restart_watcher(&app, &repo);
        }
        Ok(saved)
    })
    .await
}

#[tauri::command]
pub async fn remember_repository(state: State<'_, Shared>, path: String) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.remember_repository(&PathBuf::from(path))).await
}

/// 仅从最近仓库列表移除展示项，不删除磁盘上的仓库。
#[tauri::command]
pub async fn forget_recent_repository(
    state: State<'_, Shared>,
    path: String,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.forget_repository(&path)).await
}

/// 读取 Git 配置：一次返回用户级与当前仓库级两层的取值和生效来源。未打开仓库时仓库级为空。
#[tauri::command]
pub async fn read_git_config(state: State<'_, Shared>) -> Result<GitConfigDto> {
    let repo = current_repo(&state);
    blocking(move || git_write::config::read_git_config(repo.as_deref())).await
}

/// 把条目写入指定作用域（`user` 或 `repo`）：键名与取值由 git-write 的白名单把关，空值表示删除该项。
/// 有仓库会话时经 `GitWriteModule` 保存——项目级写 `.git/config` 与其他写操作互斥；
/// 返回重新读取后的配置，界面回显的是真实落盘结果。
#[tauri::command]
pub async fn save_git_config(
    state: State<'_, Shared>,
    scope: ConfigScope,
    entries: Vec<ConfigEntryDto>,
) -> Result<GitConfigDto> {
    let repo = current_repo(&state);
    let state = Arc::clone(&state);
    blocking(move || match repo {
        Some(repo) => state
            .with_session(|session| session.write.save_git_config(scope, Some(&repo), &entries)),
        // 未打开仓库：只可能保存用户级（项目级由 git-write 以 NotARepository 拒绝）。
        None => git_write::config::save_git_config_without_repo(scope, &entries),
    })
    .await
}

/// 配置读写用仓库路径：没有会话时返回 None，让 Git 配置面板在未打开仓库时仍可用。
fn current_repo(state: &AppState) -> Option<PathBuf> {
    state
        .with_session(|session| Ok(session.read.path().to_path_buf()))
        .ok()
}
