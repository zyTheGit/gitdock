//! Git 命令执行日志装配：环形缓冲最近 500 条 + 应用日志同步摘要。
//!
//! 选择静态 `OnceLock<Mutex<VecDeque>>` 而非 AppState 字段：recorder 的写入方是
//! git-core 执行 seam，无法访问 AppState（依赖方向：git-core 不依赖 src-tauri），
//! 全局槽是唯一注入通道；AppState 只在启动时调用 `init` 注入，command 层经
//! `snapshot` 读取。缓冲生命周期与进程一致，单窗口应用不存在多实例问题。

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use git_core::{CommandLogEntry, CommandRecorder};

use super::logging;

/// 环形缓冲上限：保留最近的命令，超出弹头部。
const MAX_ENTRIES: usize = 500;

static BUFFER: OnceLock<Mutex<VecDeque<CommandLogEntry>>> = OnceLock::new();

fn buffer() -> &'static Mutex<VecDeque<CommandLogEntry>> {
    BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_ENTRIES)))
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
    fn record(&self, entry: CommandLogEntry) {
        log_summary(&entry);
        // 锁失败（poisoned）时丢弃本条：执行日志是观测通道，不能反向拖垮执行。
        if let Ok(mut buffer) = buffer().lock() {
            if buffer.len() >= MAX_ENTRIES {
                buffer.pop_front();
            }
            buffer.push_back(entry);
        }
    }
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
