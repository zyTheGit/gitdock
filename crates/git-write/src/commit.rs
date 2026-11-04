//! 提交创建与 amend 的消息文件传递。
//!
//! 消息经系统临时目录的随机文件名传给 `git commit --file=<路径>`：`-m` 直传在消息
//! 含换行、引号或以 `-` 开头的内容时有语义压缩与选项注入风险，`--file` 让 Git 自行
//! 读取文件内容，参数数组不经 shell 的既有规则不变。文件由 [`MessageFile`] 的 Drop
//! 保证无论命令成败都在执行结束后删除；消息内容不进应用日志。

use std::io::Write as _;
use std::path::PathBuf;

use git_core::{ErrorCode, Result, UserVisibleError};

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// 提交消息临时文件；drop 时无条件删除，覆盖成功、失败与错误返回所有路径。
pub(crate) struct MessageFile {
    path: PathBuf,
}

impl MessageFile {
    /// 在系统临时目录创建随机文件名（进程 id + 纳秒时间戳前缀）并写入消息。
    /// `create_new` 拒绝覆盖同名文件；UTF-8 无 BOM 直接写原始字节。
    pub(crate) fn create(message: &str) -> Result<Self> {
        // 进程内写操作经 write_lock 串行，进程间由进程号区分；纳秒时间戳碰撞时重试。
        for _ in 0..8 {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            let pid = std::process::id();
            let path = std::env::temp_dir().join(format!("gitdock-commit-{pid}-{nanos}"));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    if let Err(e) = file.write_all(message.as_bytes()) {
                        let _ = std::fs::remove_file(&path);
                        return Err(temp_file_error(e));
                    }
                    return Ok(Self { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(temp_file_error(e)),
            }
        }
        Err(
            UserVisibleError::new(ErrorCode::Io, "无法创建提交消息临时文件")
                .with_key("errors.commitTempFileCreateFailed"),
        )
    }

    /// `--file=<路径>` 单参数；含空格的路径不经 shell 也安全。
    fn file_arg(&self) -> String {
        format!("--file={}", self.path.display())
    }
}

impl Drop for MessageFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn temp_file_error(e: std::io::Error) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Io, "无法创建提交消息临时文件")
        .with_key("errors.commitTempFileCreateFailed")
        .with_detail(e.to_string())
}

/// 提交命令参数：`git commit [--amend] --file=<临时文件>`。
/// 不携带 `--allow-empty` / `--allow-empty-message` / `--no-verify`（ADR 0007 §2.1）。
pub(crate) fn commit_args(amend: bool, file: &MessageFile) -> Vec<String> {
    let mut args = vec!["commit".to_owned()];
    if amend {
        args.push("--amend".to_owned());
    }
    args.push(file.file_arg());
    args
}
