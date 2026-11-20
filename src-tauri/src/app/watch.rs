//! 仓库文件监听：只监视 Git 目录（HEAD、refs、index 与操作态文件），
//! 事件经防抖合并后比较仓库代际，变化时才通知前端刷新。
//!
//! 约束：监听线程只读仓库并发出事件，绝不写仓库；每个标签一个监听，
//! 关闭标签或应用退出时立即停止。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use git_core::interruption::is_marker;
use notify::{RecursiveMode, Watcher};
use refresh::RefreshReason;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::logging;
use super::state::{AppState, RepoId};

pub const EVENT_REPOSITORY_CHANGED: &str = "repository-changed";

const DEBOUNCE: Duration = Duration::from_millis(350);
const POLL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Serialize)]
pub struct RepositoryChangedDto {
    /// 事件来源标签；前端按此路由到对应标签页。
    pub repo_id: RepoId,
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

/// 启动监听；`dirs` 为待监听的 Git 目录（per-worktree 目录 + 共享目录），
/// 由已打开的只读模块给出，避免再次启动 `git rev-parse` 子进程。
/// 返回 `Err` 时调用方保留既有状态，仅记录警告。
pub fn start(
    state: Weak<AppState>,
    app: AppHandle,
    repo_id: RepoId,
    repo: PathBuf,
    dirs: Vec<PathBuf>,
) -> std::result::Result<RepositoryWatcher, String> {
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
    let thread = thread::spawn(move || run_loop(rx, worker_stop, state, app, repo_id, worker_repo));

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
    repo_id: RepoId,
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
        // 只操作事件所属仓库：非活动标签的变化不能污染活动仓库的代际。
        state.request_refresh_for(repo_id, RefreshReason::Watch);
        let generation = match state.with_entry(Some(repo_id), |entry| {
            entry.session.read.current_generation()
        }) {
            Ok(generation) => generation,
            // 标签已关闭：注册表里找不到该仓库，等停止信号退出即可。
            Err(_) => continue,
        };
        let generation_changed = state.observe_generation_for(repo_id, generation);
        if !generation_changed && !metadata_touched {
            continue;
        }
        let payload = RepositoryChangedDto {
            repo_id,
            path: repo.to_string_lossy().into_owned(),
            generation,
        };
        if let Err(err) = app.emit(EVENT_REPOSITORY_CHANGED, payload) {
            logging::warn(&format!("发送仓库变更事件失败：{err}"));
        }
        state.accept_generation_for(repo_id, generation);
    }
}

/// index / config 变化不一定改变 refs 指纹，但仍需刷新工作区状态与分支描述。
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
    // 仓库元数据 + 全部中断标记（与 git-core 的 MARKERS 保持同步，含 rebase/sequencer）。
    const FILES: [&str; 6] = [
        "HEAD",
        "index",
        "packed-refs",
        "config",
        "shallow",
        "ORIG_HEAD",
    ];
    if FILES.contains(&name) || is_marker(name) {
        return true;
    }
    path.components()
        .any(|part| part.as_os_str().eq_ignore_ascii_case("refs"))
}

#[cfg(test)]
mod tests {
    use super::RepositoryChangedDto;

    #[test]
    fn changed_event_payload_carries_repo_id() {
        let payload = RepositoryChangedDto {
            repo_id: 7,
            path: "C:/work/repo".to_owned(),
            generation: 42,
        };
        let value = serde_json::to_value(&payload).expect("序列化仓库变更事件失败");
        // 前端按 repo_id 路由标签页；字段名与 TS 镜像保持一致。
        assert_eq!(value["repo_id"], 7);
        assert_eq!(value["path"], "C:/work/repo");
        assert_eq!(value["generation"], 42);
    }
}
