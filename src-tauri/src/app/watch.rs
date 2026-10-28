//! 仓库文件监听：只监视 Git 目录（HEAD、refs、index 与操作态文件），
//! 事件经防抖合并后比较仓库代际，变化时才通知前端刷新。
//!
//! 约束：监听线程只读仓库并发出事件，绝不写仓库；关闭监听或切换仓库时立即停止。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use refresh::RefreshReason;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::logging;
use super::state::AppState;

pub const EVENT_REPOSITORY_CHANGED: &str = "repository-changed";

const DEBOUNCE: Duration = Duration::from_millis(350);
const POLL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryChangedDto {
    pub path: String,
    pub generation: u64,
}

pub struct RepositoryWatcher {
    // 字段顺序即释放顺序：先断开底层监听，再等待线程退出。
    // 该字段只用于维持监听句柄存活，不直接读取。
    _watcher: notify::RecommendedWatcher,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for RepositoryWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// 启动监听；返回 `Err` 时调用方保留既有状态，仅记录警告。
pub fn start(
    state: Weak<AppState>,
    app: AppHandle,
    repo: PathBuf,
) -> std::result::Result<RepositoryWatcher, String> {
    let dirs = git_dirs(&repo);
    if dirs.is_empty() {
        return Err("无法解析 Git 目录，未启动文件监听".to_owned());
    }

    let (tx, rx) = mpsc::channel::<bool>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        if event.paths.iter().any(|path| is_relevant(path)) {
            // index / config 变化不一定改变 refs 指纹，但仍需刷新工作区状态与描述。
            let metadata = event.paths.iter().any(|path| is_metadata(path));
            let _ = tx.send(metadata);
        }
    })
    .map_err(|err| format!("创建文件监听失败：{err}"))?;

    for dir in &dirs {
        if let Err(err) = watcher.watch(dir, RecursiveMode::Recursive) {
            logging::warn(&format!("监视 {} 失败：{err}", dir.display()));
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = Arc::clone(&stop);
    let worker_repo = repo.clone();
    let thread = thread::spawn(move || run_loop(rx, worker_stop, state, app, worker_repo));

    Ok(RepositoryWatcher {
        _watcher: watcher,
        stop,
        thread: Some(thread),
    })
}

fn run_loop(
    rx: mpsc::Receiver<bool>,
    stop: Arc<AtomicBool>,
    state: Weak<AppState>,
    app: AppHandle,
    repo: PathBuf,
) {
    while !stop.load(Ordering::Relaxed) {
        let mut metadata_touched = false;
        match rx.recv_timeout(POLL) {
            Ok(metadata) => {
                metadata_touched |= metadata;
                let deadline = Instant::now() + DEBOUNCE;
                loop {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match rx.recv_timeout(remaining) {
                        Ok(metadata) => metadata_touched |= metadata,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if stop.load(Ordering::Relaxed) {
            return;
        }

        let Some(state) = state.upgrade() else {
            return;
        };
        state.request_refresh(RefreshReason::Watch);
        let generation = match state.with_session(|session| session.read.current_generation()) {
            Ok(generation) => generation,
            Err(_) => continue,
        };
        let generation_changed = state.observe_generation(generation);
        if !generation_changed && !metadata_touched {
            continue;
        }
        let payload = RepositoryChangedDto {
            path: repo.to_string_lossy().into_owned(),
            generation,
        };
        if let Err(err) = app.emit(EVENT_REPOSITORY_CHANGED, payload) {
            logging::warn(&format!("发送仓库变更事件失败：{err}"));
        }
        state.accept_generation(generation);
    }
}

/// 用 `git rev-parse` 解析 worktree 的 Git 目录与共享目录；两者在 linked worktree 中可能不同。
fn git_dirs(repo: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    for arg in ["--absolute-git-dir", "--git-common-dir"] {
        if let Some(dir) = rev_parse_dir(repo, arg) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// 构造 git 子进程。Windows GUI 程序直接启动控制台程序会触发默认终端接管，
/// 单次可阻塞数秒；CREATE_NO_WINDOW 让子进程使用无窗口控制台。
fn git_command() -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn rev_parse_dir(repo: &Path, arg: &str) -> Option<PathBuf> {
    let output = git_command()
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", arg])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if text.is_empty() {
        return None;
    }
    let path = PathBuf::from(&text);
    let absolute = if path.is_absolute() {
        path
    } else {
        repo.join(path)
    };
    Some(std::fs::canonicalize(&absolute).unwrap_or(absolute))
}

/// index / config 变化可能不改变 refs 指纹，但需要刷新工作区状态与分支描述。
fn is_metadata(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("index" | "index.lock" | "config")
    )
}

/// 只关心会改变 refs、HEAD、index 或操作态的路径，避免 objects/ 写入造成刷新风暴。
fn is_relevant(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    const FILES: [&str; 9] = [
        "HEAD",
        "index",
        "packed-refs",
        "config",
        "shallow",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "MERGE_HEAD",
        "ORIG_HEAD",
    ];
    if FILES.contains(&name) || name == "index.lock" {
        return true;
    }
    path.components()
        .any(|part| part.as_os_str().eq_ignore_ascii_case("refs"))
}
