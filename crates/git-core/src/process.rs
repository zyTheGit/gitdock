//! 子进程构造：GUI 进程启动控制台程序时统一隐藏控制台窗口。

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
