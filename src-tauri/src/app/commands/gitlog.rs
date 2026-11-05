//! Git 命令日志 command：只读快照，无参数、无路径通道。
//!
//! 快照取自静态环形缓冲（见 `app::gitlog`），与仓库会话无关，
//! 因此不需要 AppState；命令仍返回 `Result<Dto, UserVisibleError>` 走 seam 契约。

use git_core::{CommandLogEntry, Result};

use crate::app::gitlog;

#[tauri::command]
pub fn git_command_log() -> Result<Vec<CommandLogEntry>> {
    Ok(gitlog::snapshot())
}
#[tauri::command]
pub fn clear_git_command_log() -> Result<()> {
    gitlog::clear();
    Ok(())
}
