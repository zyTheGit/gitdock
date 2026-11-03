//! Git 命令执行日志：统一执行 seam 与记录器契约。
//!
//! GitDock 代执行的 git CLI 调用散在多个模块（写操作、staging 读、config 读写、
//! 版本探测、监听目录解析），成功/失败需要有唯一观测点，因此执行入口收敛到
//! 这里的两个 helper；LazyGit 终端会话与外部 diff 工具不经过这里，不纳入日志。
//!
//! 依赖方向：本模块只依赖 std 与 serde；计时用 `Instant`、起点用 `SystemTime`，
//! 记录器由应用外壳（src-tauri）在启动时注入，运行期不可替换。

use std::io::Write;
use std::path::Path;
use std::process::{Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::git_command;

/// stderr 摘要上限：足以诊断常见失败（usage、冲突提示），又不放大日志体积。
const STDERR_HEAD_BYTES: usize = 512;

/// 一条 Git 命令执行记录；字段与前端 `CommandLogEntryDto` 契约一致（蛇形命名）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandLogEntry {
    pub id: u64,
    /// 命令启动时刻的 Unix 毫秒时间戳。
    pub started_at_ms: u64,
    pub duration_ms: u64,
    /// 执行目录；继承进程 cwd（如版本探测）时为空字符串。
    pub cwd: String,
    /// 参数列表，不含程序名 "git"。
    pub args: Vec<String>,
    /// 退出码；进程启动失败时为 `None`。
    pub exit_code: Option<i32>,
    /// stderr 前 512 字节的有损解码；空输出为 `None`。
    pub stderr_head: Option<String>,
    /// 启动成功且退出码为 0。
    pub success: bool,
}

/// 命令记录器：由应用外壳注入，实现方负责自己的缓冲与持久化。
pub trait CommandRecorder: Send + Sync {
    fn record(&self, entry: CommandLogEntry);
}

static RECORDER: OnceLock<Box<dyn CommandRecorder + Send + Sync>> = OnceLock::new();

/// 命令 id 发号器：进程内单调递增；recorder 未注入时不消耗。
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// 注入全局记录器。语义：**第一次调用生效，后续调用返回 `false` 并忽略**——
/// 应用只应在启动时注入一次；OnceLock 不可撤销，运行中的命令不会因记录器被
/// 替换而丢失落点。
pub fn set_recorder(recorder: Box<dyn CommandRecorder + Send + Sync>) -> bool {
    RECORDER.set(recorder).is_ok()
}

/// 运行 git 命令并捕获输出（stdout/stderr 均为管道）。
///
/// 命令结束（无论成败）后组装记录写入 recorder；未注入 recorder 时为 no-op。
/// 成败判定交给调用方：这里返回原始 `Output`；io 失败（无法启动）时以
/// `exit_code=None / success=false` 记录后原样返回 `Err`。
pub fn run_git_output(
    cwd: Option<&Path>,
    args: &[&str],
    envs: &[(&str, &str)],
) -> std::io::Result<Output> {
    let started_at = SystemTime::now();
    let timer = Instant::now();
    let mut command = git_command();
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.args(args);
    for (key, value) in envs {
        command.env(key, value);
    }
    let result = command.output();
    record(cwd, args, started_at, timer, result.as_ref().ok());
    result
}

/// 运行需要 stdin 输入的 git 命令（如 pathspec 从标准输入传入的 stage/unstage）。
///
/// stdin 写失败时 kill 子进程并等待回收后再返回 `Err`——语义与原 git-write
/// 内联实现完全一致，整体下沉到统一 seam。
pub fn run_git_with_stdin(
    cwd: Option<&Path>,
    args: &[&str],
    envs: &[(&str, &str)],
    stdin: &[u8],
) -> std::io::Result<Output> {
    let started_at = SystemTime::now();
    let timer = Instant::now();
    let mut command = git_command();
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in envs {
        command.env(key, value);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            // io::Error 不可 Clone：失败路径只记「无输出」语义（exit_code=None）。
            record(cwd, args, started_at, timer, None);
            return Err(err);
        }
    };
    let write_result = child
        .stdin
        .take()
        .map(|mut pipe| pipe.write_all(stdin))
        .unwrap_or(Ok(()));
    if let Err(err) = write_result {
        // stdin 管道断裂：kill 并回收子进程，不让它带着半截输入继续跑。
        let _ = child.kill();
        let _ = child.wait();
        record(cwd, args, started_at, timer, None);
        return Err(err);
    }
    let result = child.wait_with_output();
    record(cwd, args, started_at, timer, result.as_ref().ok());
    result
}

/// 组装并分发一条记录；recorder 未注入时静默跳过（不消耗 id）。
/// `output` 为 `None` 表示进程未产出结果（启动失败或执行中断），此时
/// `exit_code=None / success=false`。
#[allow(clippy::too_many_arguments)]
fn record(
    cwd: Option<&Path>,
    args: &[&str],
    started_at: SystemTime,
    timer: Instant,
    output: Option<&Output>,
) {
    let Some(recorder) = RECORDER.get() else {
        return;
    };
    let entry = CommandLogEntry {
        id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        started_at_ms: unix_ms(started_at),
        duration_ms: timer.elapsed().as_millis() as u64,
        cwd: cwd
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        exit_code: output.and_then(|output| output.status.code()),
        stderr_head: output.and_then(|output| stderr_head(&output.stderr)),
        success: output.is_some_and(|output| output.status.success()),
    };
    recorder.record(entry);
}

/// Unix 毫秒；时钟早于纪元（理论不可能）时按 0 处理，记录不因此失败。
fn unix_ms(started_at: SystemTime) -> u64 {
    started_at
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// stderr 前 512 字节的有损解码；空输出记为 `None`。
fn stderr_head(stderr: &[u8]) -> Option<String> {
    let head = &stderr[..stderr.len().min(STDERR_HEAD_BYTES)];
    (!head.is_empty()).then(|| String::from_utf8_lossy(head).into_owned())
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    /// 测试收集器。全局槽（OnceLock）一次性注入且不可撤销，并行测试会互相
    /// 串扰，因此全部场景合并进唯一一个测试函数内串行断言。
    #[derive(Default)]
    struct Collector {
        entries: Mutex<Vec<CommandLogEntry>>,
    }

    impl CommandRecorder for Collector {
        fn record(&self, entry: CommandLogEntry) {
            self.entries.lock().expect("收集器锁").push(entry);
        }
    }

    /// `Collector` 的共享句柄包装：注入全局槽后测试侧仍能读取收集结果。
    struct SharedCollector(Arc<Collector>);

    impl CommandRecorder for SharedCollector {
        fn record(&self, entry: CommandLogEntry) {
            self.0.record(entry)
        }
    }

    #[test]
    fn records_success_failure_and_stdin_commands() {
        let collector = Arc::new(Collector::default());
        let injected = set_recorder(Box::new(SharedCollector(Arc::clone(&collector))));
        assert!(injected, "本测试二进制内全局记录槽应可注入（首个使用者）");

        // 1. 成功命令：`git --version` 在 Windows CI 上同样可用。
        let ok = run_git_output(None, &["--version"], &[]).expect("git --version 应可执行");
        assert!(ok.status.success());

        // 2. 失败命令：未知旗标，进程启动成功但退出码非零。
        let bad = run_git_output(None, &["--definitely-not-a-flag"], &[])
            .expect("未知旗标仍应能启动进程");
        assert!(!bad.status.success());

        // 3. stdin 路径：`hash-object --stdin` 只读不写库，验证管道写入与记录。
        let hashed = run_git_with_stdin(None, &["hash-object", "--stdin"], &[], b"gitdock\n")
            .expect("stdin 管道应可写入");
        assert!(hashed.status.success());
        assert!(!hashed.stdout.is_empty());

        let entries = collector.entries.lock().expect("收集器锁").clone();
        assert_eq!(entries.len(), 3, "三次执行都应记录");
        assert!(
            entries.windows(2).all(|pair| pair[0].id < pair[1].id),
            "id 单调递增"
        );

        let success_entry = &entries[0];
        assert_eq!(success_entry.args, vec!["--version"]);
        assert_eq!(success_entry.exit_code, Some(0));
        assert!(success_entry.success);
        assert!(success_entry.stderr_head.is_none());
        assert_eq!(success_entry.cwd, "");
        assert!(success_entry.started_at_ms > 0);
        assert!(success_entry.duration_ms < 60_000);

        let failure_entry = &entries[1];
        assert_eq!(failure_entry.args, vec!["--definitely-not-a-flag"]);
        assert!(!failure_entry.success);
        assert_ne!(failure_entry.exit_code, Some(0));
        assert!(
            failure_entry.stderr_head.is_some(),
            "失败命令应有 stderr 摘要"
        );

        let stdin_entry = &entries[2];
        assert_eq!(stdin_entry.args, vec!["hash-object", "--stdin"]);
        assert!(stdin_entry.success);
        assert_eq!(stdin_entry.exit_code, Some(0));
    }
}
