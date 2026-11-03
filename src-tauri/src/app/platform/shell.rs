//! 默认 Shell 解析：三平台的程序路径与启动参数。

use git_core::Result;
use std::path::PathBuf;
// 错误构造只在 Windows 分支（SystemRoot 缺失）；非 Windows 下无对应错误路径。
#[cfg(windows)]
use git_core::{ErrorCode, UserVisibleError};

/// 解析后的默认 Shell：绝对路径 + 平台专属参数。
pub(crate) struct ShellProgram {
    pub path: PathBuf,
    pub args: Vec<String>,
}

/// 用户默认 Shell（登录环境）。终端模式 `shell` 的唯一来源。
///
/// macOS/Linux 读 `$SHELL` 并校验为存在的绝对路径，回落平台默认（zsh/bash），
/// 传 `-l` 使 PATH 取登录环境（LazyGit 等用户安装的工具常在 profile 追加的
/// 目录中）。Windows 走 System32 绝对路径 PowerShell：相对程序名会先按父进程
/// 当前目录解析，从仓库目录启动应用时仓库内伪造的 powershell.exe 会先于系统
/// 执行；PowerShell 还需显式设 UTF-8，否则 ConPTY 下中文按 GBK 输出成乱码。
pub(crate) fn default_shell() -> Result<ShellProgram> {
    #[cfg(windows)]
    {
        let system_root = std::env::var("SystemRoot").map_err(|_| {
            UserVisibleError::new(
                ErrorCode::ExternalToolFailed,
                "未找到 PowerShell：缺少 SystemRoot 环境变量",
            )
            .with_key("errors.terminalPowershellNotFound")
        })?;
        Ok(ShellProgram {
            path: PathBuf::from(system_root)
                .join(r"System32\WindowsPowerShell\v1.0\powershell.exe"),
            args: vec![
                "-NoLogo".to_owned(),
                "-NoExit".to_owned(),
                "-Command".to_owned(),
                "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);\
                 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);\
                 $OutputEncoding=[Text.UTF8Encoding]::new($false)"
                    .to_owned(),
            ],
        })
    }
    #[cfg(not(windows))]
    {
        let fallback = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        let path = std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.is_file())
            .unwrap_or_else(|| PathBuf::from(fallback));
        Ok(ShellProgram {
            path,
            args: vec!["-l".to_owned()],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_points_to_existing_program() {
        let shell = default_shell().expect("解析默认 Shell 失败");
        assert!(shell.path.is_absolute());
        assert!(shell.path.is_file(), "{} 应存在", shell.path.display());
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_shell_uses_login_flag() {
        let shell = default_shell().expect("解析默认 Shell 失败");
        assert_eq!(shell.args, vec!["-l".to_owned()]);
    }
}
