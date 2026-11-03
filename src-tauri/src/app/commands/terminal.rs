//! 终端域 command：能力探测与 PTY 会话的打开/写入/调整/关闭。
//!
//! 这里只承载 command 定义；PTY 实现在 `app::terminal`。

use git_core::Result;
use tauri::State;

use super::Shared;
use crate::app::terminal::{self, TerminalCapabilitiesDto, TerminalEvent};

#[tauri::command]
pub fn terminal_capabilities(state: State<'_, Shared>) -> Result<TerminalCapabilitiesDto> {
    terminal::capabilities(&state)
}

/// 工作目录由后端取当前仓库；前端只能选择模式与 PTY 尺寸。
#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    mode: String,
    cols: u16,
    rows: u16,
    channel: tauri::ipc::Channel<TerminalEvent>,
) -> Result<u64> {
    terminal::open(&state, &app, &mode, cols, rows, channel)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, Shared>, id: u64, data: String) -> Result<()> {
    terminal::write(&state, id, &data)
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, Shared>, id: u64, cols: u16, rows: u16) -> Result<()> {
    terminal::resize(&state, id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(state: State<'_, Shared>, id: u64) {
    terminal::close(&state, id);
}
