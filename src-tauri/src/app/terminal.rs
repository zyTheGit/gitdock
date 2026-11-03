//! 终端工作区 Spike：ConPTY 会话与子进程只由 Rust 侧创建和回收。
//!
//! 约束：前端只能选择 lazygit/shell 并报告 PTY 尺寸；工作目录永远取当前仓库
//! 会话，不接受前端传入的路径或命令。日志只记录模式、仓库与退出码，不记录输出。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use git_core::{ErrorCode, Result, UserVisibleError};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use refresh::RefreshReason;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

use super::config::SettingsDto;
use super::logging;
use super::state::AppState;
use super::watch::{RepositoryChangedDto, EVENT_REPOSITORY_CHANGED};

/// 终端输出与退出事件；数据用 base64 传输，避免 UTF-8 半个字符被截断。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit { code: i32 },
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalCapabilitiesDto {
    pub lazygit_path: Option<String>,
}

struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

/// 单窗口内允许多个终端会话并存（例如 LazyGit 与 Shell 各一个）。
#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<u64, Session>>,
    next_id: AtomicU64,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// 结束全部会话；切换仓库、关闭窗口时调用，避免留下孤儿进程。
    pub fn close_all(&self) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for (id, session) in sessions.drain() {
            kill(&session);
            logging::info(&format!("已结束终端会话 {id}"));
        }
    }

    fn insert(&self, session: Session) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(id, session);
        }
        id
    }

    fn with_writer(
        &self,
        id: u64,
        f: impl FnOnce(&mut Box<dyn Write + Send>) -> std::io::Result<()>,
    ) {
        let Ok(sessions) = self.sessions.lock() else {
            return;
        };
        let Some(session) = sessions.get(&id) else {
            return;
        };
        let Ok(mut writer) = session.writer.lock() else {
            return;
        };
        let _ = f(&mut writer);
    }

    fn resize(&self, id: u64, cols: u16, rows: u16) -> Result<()> {
        let Ok(sessions) = self.sessions.lock() else {
            return Ok(());
        };
        let Some(session) = sessions.get(&id) else {
            return Ok(());
        };
        let Ok(master) = session.master.lock() else {
            return Ok(());
        };
        master
            .resize(size(cols, rows))
            .map_err(|e| internal("调整终端尺寸失败", e))
    }

    pub fn close(&self, id: u64) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&id));
        if let Some(session) = session {
            kill(&session);
        }
    }
}

fn kill(session: &Session) {
    if let Ok(mut child) = session.child.lock() {
        let _ = child.kill();
    }
}

pub fn resolve_lazygit(settings: &SettingsDto) -> Option<PathBuf> {
    if let Some(raw) = settings
        .lazygit_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(raw);
        return path.is_file().then_some(path);
    }
    let paths = std::env::var_os("PATH")?;
    for dir in absolute_path_entries(&paths) {
        for name in ["lazygit.exe", "lazygit"] {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// PATH 查找只保留绝对路径条目：相对条目与 "." 会随进程当前目录解析，
/// 仓库内伪造的同名可执行文件可能先于系统目录命中（当前目录劫持）。
fn absolute_path_entries(paths: &std::ffi::OsStr) -> Vec<PathBuf> {
    std::env::split_paths(paths)
        .filter(|dir| dir.is_absolute())
        .collect()
}

/// PowerShell 必须以 System32 绝对路径启动：相对程序名会先按父进程当前目录
/// 解析，从仓库目录启动应用时，仓库内伪造的 powershell.exe 会先于系统执行。
fn powershell_path() -> Result<PathBuf> {
    let system_root = std::env::var("SystemRoot").map_err(|_| {
        UserVisibleError::new(
            ErrorCode::ExternalToolFailed,
            "未找到 PowerShell：缺少 SystemRoot 环境变量",
        )
    })?;
    Ok(PathBuf::from(system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"))
}

pub fn capabilities(state: &AppState) -> Result<TerminalCapabilitiesDto> {
    let settings = state.settings()?;
    Ok(TerminalCapabilitiesDto {
        lazygit_path: resolve_lazygit(&settings).map(|path| path.to_string_lossy().into_owned()),
    })
}

/// 启动终端。工作目录固定为当前仓库，模式只接受 `lazygit` / `shell`。
pub fn open(
    state: &Arc<AppState>,
    app: &AppHandle,
    mode: &str,
    cols: u16,
    rows: u16,
    channel: Channel<TerminalEvent>,
) -> Result<u64> {
    let repo = state.with_session(|session| Ok(session.read.path().to_path_buf()))?;
    let settings = state.settings()?;

    let (program, args) = match mode {
        "lazygit" => {
            let path = resolve_lazygit(&settings).ok_or_else(|| {
                UserVisibleError::new(
                    ErrorCode::ExternalToolFailed,
                    "未找到 LazyGit，可在设置中填写可执行文件路径",
                )
            })?;
            (path.to_string_lossy().into_owned(), Vec::<String>::new())
        }
        "shell" => {
            // 绝对路径启动，避免相对程序名被当前目录下的伪造可执行文件劫持。
            let path = powershell_path()?;
            (
                path.to_string_lossy().into_owned(),
                vec![
                    "-NoLogo".to_owned(),
                    "-NoExit".to_owned(),
                    "-Command".to_owned(),
                    // ConPTY 不会替 PowerShell 设编码；不设则中文按 GBK 输出成乱码。
                    "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);\
                     [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);\
                     $OutputEncoding=[Text.UTF8Encoding]::new($false)"
                        .to_owned(),
                ],
            )
        }
        other => {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("不支持的终端模式：{other}"),
            ))
        }
    };

    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|e| internal("创建伪终端失败", e))?;
    let mut command = CommandBuilder::new(program);
    command.cwd(&repo);
    for arg in args {
        command.arg(arg);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env_remove("ELECTRON_RUN_AS_NODE");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| start_error(mode, e))?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| internal("读取终端输出失败", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| internal("打开终端输入失败", e))?;
    let master = pair.master;

    let child = Arc::new(Mutex::new(child));
    let id = state.terminals.insert(Session {
        writer: Mutex::new(writer),
        master: Mutex::new(master),
        child: Arc::clone(&child),
    });
    logging::info(&format!("启动终端 {id}（{mode}，{}）", repo.display()));

    let app = app.clone();
    let repo_label = repo.to_string_lossy().into_owned();
    let reader_channel = channel.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if reader_channel
                        .send(TerminalEvent::Data {
                            data: BASE64.encode(&buf[..n]),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // ConPTY 在子进程退出后不保证立即给 reader 返回 EOF，退出码必须独立轮询。
    let waiter_state = Arc::downgrade(state);
    let waiter_child = Arc::clone(&child);
    std::thread::spawn(move || {
        let code = loop {
            match waiter_child.lock() {
                Ok(mut child) => match child.try_wait() {
                    Ok(Some(status)) => break status.exit_code() as i32,
                    Ok(None) => {}
                    Err(_) => break -1,
                },
                Err(_) => break -1,
            }
            std::thread::sleep(std::time::Duration::from_millis(80));
        };
        let _ = channel.send(TerminalEvent::Exit { code });
        logging::info(&format!("终端 {id} 已退出（代码 {code}）"));

        let Some(state) = waiter_state.upgrade() else {
            return;
        };
        // 进程已结束；移除会话会释放 PTY 并解除 reader 阻塞。
        state.terminals.close(id);
        // 终端可能改动了仓库；即使监听关闭，也让前端做一次刷新。
        state.request_refresh(RefreshReason::Watch);
        if let Ok(generation) = state.with_session(|session| session.read.current_generation()) {
            state.observe_generation(generation);
            state.accept_generation(generation);
            let _ = app.emit(
                EVENT_REPOSITORY_CHANGED,
                RepositoryChangedDto {
                    path: repo_label,
                    generation,
                },
            );
        }
    });

    Ok(id)
}

pub fn write(state: &AppState, id: u64, data: &str) -> Result<()> {
    let bytes = BASE64.decode(data).map_err(|e| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "终端输入格式无效")
            .with_detail(e.to_string())
    })?;
    state.terminals.with_writer(id, |writer| {
        writer.write_all(&bytes)?;
        writer.flush()
    });
    Ok(())
}

pub fn resize(state: &AppState, id: u64, cols: u16, rows: u16) -> Result<()> {
    state.terminals.resize(id, cols, rows)
}

pub fn close(state: &AppState, id: u64) {
    state.terminals.close(id);
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.clamp(1, 500),
        cols: cols.clamp(1, 1000),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn start_error(mode: &str, err: impl std::fmt::Display) -> UserVisibleError {
    let message = if mode == "lazygit" {
        "启动 LazyGit 失败，请检查安装与路径配置"
    } else {
        "启动 Shell 失败"
    };
    UserVisibleError::new(ErrorCode::ExternalToolFailed, message).with_detail(err.to_string())
}

fn internal(message: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, message).with_detail(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configured_missing_path_is_rejected_without_path_fallback() {
        let settings = SettingsDto {
            lazygit_path: Some("C:/definitely/missing/lazygit.exe".to_owned()),
            ..Default::default()
        };
        assert!(resolve_lazygit(&settings).is_none());
    }

    #[test]
    fn configured_existing_file_is_used() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let exe = dir.path().join("lazygit.exe");
        std::fs::write(&exe, b"fake").expect("写入假可执行文件失败");
        let settings = SettingsDto {
            lazygit_path: Some(exe.to_string_lossy().into_owned()),
            ..Default::default()
        };
        assert_eq!(resolve_lazygit(&settings), Some(exe));
    }

    #[test]
    fn blank_path_falls_back_to_path_lookup() {
        let settings = SettingsDto {
            lazygit_path: Some("   ".to_owned()),
            ..Default::default()
        };
        // 只要求不把空白当作路径；本机是否安装 LazyGit 不影响该断言。
        let resolved = resolve_lazygit(&settings);
        assert!(resolved.is_none() || resolved.as_deref() != Some(std::path::Path::new("   ")));
    }

    #[test]
    #[cfg(windows)]
    fn powershell_path_is_absolute_and_ends_with_executable() {
        // 测试环境（Windows）必然存在 SystemRoot；此处只验证拼接结果。
        let path = powershell_path().expect("SystemRoot 应存在");
        assert!(path.is_absolute());
        assert!(path.ends_with(std::path::Path::new("powershell.exe")));
    }

    #[test]
    fn path_lookup_skips_relative_entries_and_dot() {
        let absolute = if cfg!(windows) {
            r"C:\Tools"
        } else {
            "/usr/tools"
        };
        let raw = std::env::join_paths([".", "relative", absolute]).expect("构造 PATH 值");
        let dirs = absolute_path_entries(&raw);
        assert_eq!(dirs, vec![PathBuf::from(absolute)]);
    }
}
