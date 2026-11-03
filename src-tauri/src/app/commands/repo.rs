//! 仓库会话域 command：启动传参、打开/关闭仓库与会话状态读取。

use std::path::PathBuf;
use std::sync::Arc;

use git_core::{ErrorCode, RepoStateDto, Result, UserVisibleError};
use git_read::GitReadModule;
use git_write::GitWriteModule;
use refresh::RefreshReason;
use tauri::State;

use super::{blocking, Shared};
use crate::app::logging;
use crate::app::state::Session;

#[tauri::command]
pub fn startup_repository() -> Option<String> {
    // F1 启动传参：取第一个非选项参数，路径校验与打开交给 open_repository。
    std::env::args_os()
        .skip(1)
        .find(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(|arg| arg.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_repository(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    path: String,
) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let dir = PathBuf::from(path);
        let canonical = std::fs::canonicalize(&dir).map_err(|e| {
            UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不存在或不可访问")
                .with_detail(e.to_string())
        })?;
        if !canonical.is_dir() {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "请选择仓库目录",
            ));
        }
        let open_path = PathBuf::from(crate::app::config::strip_verbatim(&canonical));
        let read = GitReadModule::open(&open_path, Some(state.paths.index_cache_dir.clone()))?;
        let write = GitWriteModule::new(&open_path)?;
        let mut state_dto = read.state()?;
        // 写前 Gate 与启动恢复共用同一检测来源，避免只读模块与写模块给出不同中断态。
        state_dto.interruption = write.inspect_interruption()?;
        logging::info(&format!(
            "打开仓库 {}（{}，generation {}）",
            state_dto.path,
            state_dto.object_format.as_str(),
            state_dto.generation
        ));
        // 切换仓库前结束旧终端，避免旧仓库的 LazyGit/Shell 继续运行并改动旧仓库。
        state.terminals.close_all();
        state.replace_session(Some(Session { read, write }))?;
        state.request_refresh(RefreshReason::Manual);
        state.accept_generation(state_dto.generation);
        state.restart_watcher(&app, &open_path);
        Ok(state_dto)
    })
    .await
}

#[tauri::command]
pub async fn close_repository(state: State<'_, Shared>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.stop_watcher();
        state.terminals.close_all();
        state.close()?;
        logging::info("关闭仓库");
        Ok(())
    })
    .await
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
