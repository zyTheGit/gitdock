//! 子进程构造与统一执行 seam。
//!
//! `git_command` 系列负责 GUI 进程启动控制台程序时统一隐藏控制台窗口；
//! `recorder` 在此之上提供带计时与执行日志的统一执行入口，供各调用方收敛。

pub mod recorder;

use std::process::Command;

/// Windows GUI 程序直接启动控制台程序会触发默认终端接管，单次可阻塞数秒；
/// `CREATE_NO_WINDOW` 让子进程使用无窗口控制台。
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// 构造带无窗口标志的 `git` 子进程。
pub fn git_command() -> Command {
    let mut command = Command::new("git");
    hide_console(&mut command);
    command
}
/// 将子进程输出等原始字节按 UTF-8 有损解码为 String；非法字节替换为 U+FFFD。
pub fn lossy_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
