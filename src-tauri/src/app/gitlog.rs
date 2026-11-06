//! Git 命令执行日志装配：环形缓冲最近 500 条 + 应用日志同步摘要。
//!
//! 选择静态 `OnceLock<Mutex<VecDeque>>` 而非 AppState 字段：recorder 的写入方是
//! git-core 执行 seam，无法访问 AppState（依赖方向：git-core 不依赖 src-tauri），
//! 全局槽是唯一注入通道；AppState 只在启动时调用 `init` 注入，command 层经
//! `snapshot` 读取。缓冲生命周期与进程一致，单窗口应用不存在多实例问题。
//! 前端实时刷新：每条记录入队后经 `CHANGED_EVENT` 通知前端重拉快照，
//! emitter 同样走全局槽注入（AppHandle 在启动装配时提供）。

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use git_core::{CommandLogEntry, CommandRecorder};
use tauri::{AppHandle, Emitter};

use super::config::strip_verbatim_text;
use super::logging;

/// 环形缓冲上限：保留最近的命令，超出弹头部。
const MAX_ENTRIES: usize = 500;

/// 命令日志变更事件：前端在日志标签激活期间订阅，收到后重拉快照。
pub const CHANGED_EVENT: &str = "gitlog://changed";

static BUFFER: OnceLock<Mutex<VecDeque<CommandLogEntry>>> = OnceLock::new();
static EMITTER: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

fn buffer() -> &'static Mutex<VecDeque<CommandLogEntry>> {
    BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)))
}

fn emitter() -> &'static Mutex<Option<AppHandle>> {
    EMITTER.get_or_init(|| Mutex::new(None))
}

/// 注入事件发射器（AppHandle）；重复调用覆盖旧值（测试重复装配安全）。
pub fn set_emitter(handle: AppHandle) {
    if let Ok(mut slot) = emitter().lock() {
        *slot = Some(handle);
    }
}

/// 注入全局 recorder；应在 `logging::init` 之后调用，摘要才能落入应用日志。
/// 全局槽语义见 `git_core::set_recorder`：首次注入生效，重复调用被忽略。
pub fn init() {
    if git_core::set_recorder(Box::new(CommandLogRecorder)) {
        logging::info("已启用 Git 命令执行日志");
    }
}

struct CommandLogRecorder;

impl CommandRecorder for CommandLogRecorder {
    fn record(&self, mut entry: CommandLogEntry) {
        // 日志只用于展示：剥离 Windows canonicalize 的 `\\?\` 前缀，执行路径不受影响。
        entry.cwd = strip_verbatim_text(&entry.cwd);
        log_summary(&entry);
        // 锁失败（poisoned）时丢弃本条：执行日志是观测通道，不能反向拖垮执行。
        if let Ok(mut buffer) = buffer().lock() {
            if buffer.len() >= MAX_ENTRIES {
                buffer.pop_front();
            }
            buffer.push_back(entry);
            emit_changed();
        }
    }
}

/// 通知前端日志已更新；发射失败静默忽略，与缓冲写入的观测通道语义一致。
fn emit_changed() {
    let handle = match emitter().lock() {
        Ok(slot) => match slot.as_ref() {
            Some(handle) => handle.clone(),
            None => return,
        },
        Err(_) => return,
    };
    let _ = handle.emit(CHANGED_EVENT, ());
}

/// 应用日志同步写一行摘要：成功 info、失败 warn，便于用户报告问题时对时间线。
fn log_summary(entry: &CommandLogEntry) {
    let command = entry.args.join(" ");
    let exit = match entry.exit_code {
        Some(code) => code.to_string(),
        None => "未启动".to_owned(),
    };
    let line = format!("git {command} → exit {exit} ({}ms)", entry.duration_ms);
    if entry.success {
        logging::info(&line);
    } else {
        logging::warn(&line);
    }
}

/// 最近命令的只读快照；入队顺序即 id 升序，天然有序无需再排。
pub fn snapshot() -> Vec<CommandLogEntry> {
    buffer()
        .lock()
        .map(|buffer| buffer.iter().cloned().collect())
        .unwrap_or_default()
}
/// 清空本次运行的内存日志；磁盘应用日志不受影响。
pub fn clear() {
    if let Ok(mut buffer) = buffer().lock() {
        buffer.clear();
    }
}
