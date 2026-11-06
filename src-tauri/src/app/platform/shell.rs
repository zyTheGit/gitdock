//! Shell 解析：三平台的程序路径与启动参数（含 Windows 的 Git Bash 启动器）。

use git_core::Result;
use std::path::PathBuf;
// 错误构造只在 Windows 分支（SystemRoot 缺失）；非 Windows 下无对应错误路径。
#[cfg(windows)]
use git_core::{ErrorCode, UserVisibleError};

/// 解析后的 Shell：绝对路径 + 平台专属参数。
pub(crate) struct ShellProgram {
    pub path: PathBuf,
    pub args: Vec<String>,
}

/// 终端 Shell 模式的启动器；存储值见 config::SHELL_PROFILES（default / git_bash）。
/// 非 Windows 平台上 Git Bash 无意义，`resolve_shell` 回落系统默认。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShellProfile {
    Default,
    GitBash,
}

impl ShellProfile {
    /// 从 settings 的存储值解析；未知值按系统默认（load 侧已回落，此处兜底）。
    pub(crate) fn from_stored(value: &str) -> Self {
        match value {
            "git_bash" => Self::GitBash,
            _ => Self::Default,
        }
    }
}

/// 按启动器解析 Shell（登录环境）。终端模式 `shell` 的唯一来源。
///
/// macOS/Linux 读 `$SHELL` 并校验为存在的绝对路径，回落平台默认（zsh/bash），
/// 传 `-l` 使 PATH 取登录环境（LazyGit 等用户安装的工具常在 profile 追加的
/// 目录中）。Windows 默认走 System32 绝对路径 PowerShell：相对程序名会先按
/// 父进程当前目录解析，从仓库目录启动应用时仓库内伪造的 powershell.exe 会
/// 先于系统执行；PowerShell 还需显式设 UTF-8，否则 ConPTY 下中文按 GBK
/// 输出成乱码。Git Bash 启动器在 Windows 上解析 `bin\bash.exe`（探测不到
/// 时自动回退 PowerShell），其余平台一律回落系统默认。
pub(crate) fn resolve_shell(profile: ShellProfile) -> Result<ShellProgram> {
    #[cfg(windows)]
    {
        if let ShellProfile::GitBash = profile {
            if let Some(path) = detect_git_bash() {
                // --login 生效 /etc/profile（HOME、MSYS PATH、路径转换完整）；
                // -i 与官方 git-bash 快捷方式一致，ConPTY 下 stdin 是 pty，
                // bash 本会进交互模式，显式传 -i 只为最小惊讶。
                return Ok(ShellProgram {
                    path,
                    args: vec!["--login".to_owned(), "-i".to_owned()],
                });
            }
            // 探测不到 bash.exe（未安装或保存后 Git 被卸载）：自动回退 PowerShell
            // 而非报 GitBashNotFound；该错误 key 保留给后续显式提示场景。
        }
        windows_powershell()
    }
    #[cfg(not(windows))]
    {
        let _ = profile;
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

/// Windows 系统默认 Shell：System32 绝对路径 PowerShell。
/// Default 启动器与 Git Bash 探测失败后的回退共用此构造。
#[cfg(windows)]
fn windows_powershell() -> Result<ShellProgram> {
    let system_root = std::env::var("SystemRoot").map_err(|_| {
        UserVisibleError::new(
            ErrorCode::ExternalToolFailed,
            "未找到 PowerShell：缺少 SystemRoot 环境变量",
        )
        .with_key("errors.terminalPowershellNotFound")
    })?;
    Ok(ShellProgram {
        path: PathBuf::from(system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"),
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

/// 探测 Git for Windows 自带的 bash.exe；全程只做 `is_file()` 检查、不启动进程
/// （ADR-0005 §4 安全约定）。
///
/// 顺序：先从 PATH 的绝对条目定位 git.exe——Git for Windows 的 PATH 布局通常
/// 是 `<install>\cmd\git.exe`，父目录即安装根；再回退常见安装根逐一尝试。
/// `bin\bash.exe` 与 `usr\bin\bash.exe` 均可用，前者是 Windows Terminal 的
/// Git Bash profile 同款入口；`git-bash.exe` 是 mintty 启动器会另开窗口，
/// 不适合 ConPTY，故不探测。
#[cfg(windows)]
pub(crate) fn detect_git_bash() -> Option<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in super::absolute_path_entries(&paths) {
            if dir.join("git.exe").is_file() {
                // PATH 布局可能是 <install>\cmd 或 <install>\bin 或 <install>\mingw64\bin。
                for depth in 0..=2 {
                    if let Some(install) = dir.ancestors().nth(depth) {
                        for bash in ["bin\\bash.exe", "usr\\bin\\bash.exe"] {
                            let candidate = install.join(bash);
                            if candidate.is_file() {
                                return Some(candidate);
                            }
                        }
                    }
                }
            }
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(dir) = std::env::var_os(key) {
            roots.push(PathBuf::from(dir));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Programs"));
    }
    for root in roots {
        let install = root.join("Git");
        for bash in ["bin\\bash.exe", "usr\\bin\\bash.exe"] {
            let candidate = install.join(bash);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shell_points_to_existing_program() {
        let shell = resolve_shell(ShellProfile::Default).expect("解析默认 Shell 失败");
        assert!(shell.path.is_absolute());
        assert!(shell.path.is_file(), "{} 应存在", shell.path.display());
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_shell_uses_login_flag() {
        let shell = resolve_shell(ShellProfile::Default).expect("解析默认 Shell 失败");
        assert_eq!(shell.args, vec!["-l".to_owned()]);
    }

    #[cfg(not(windows))]
    #[test]
    fn git_bash_falls_back_to_default_on_unix() {
        // 非 Windows 无 Git Bash 概念：回落系统默认而非报错（settings 跨平台携带）。
        let shell = resolve_shell(ShellProfile::GitBash).expect("回落系统默认失败");
        assert_eq!(
            shell.args,
            resolve_shell(ShellProfile::Default)
                .expect("解析默认失败")
                .args
        );
    }

    #[cfg(windows)]
    #[test]
    fn git_bash_detection_result_points_to_existing_file() {
        // 装了 Git for Windows 的机器上应能探测到；探测路径必须存在。
        if let Some(path) = detect_git_bash() {
            assert!(path.is_file(), "{} 应存在", path.display());
            assert!(
                path.to_string_lossy().to_lowercase().ends_with("bash.exe"),
                "探测结果应是 bash.exe"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn git_bash_falls_back_to_powershell_when_not_detected() {
        // 探测不到 bash.exe 时不再报 GitBashNotFound，而是回退 PowerShell。
        let shell = resolve_shell(ShellProfile::GitBash).expect("解析 Git Bash 失败");
        assert!(shell.path.is_absolute());
        assert!(shell.path.is_file(), "{} 应存在", shell.path.display());
        let path = shell.path.to_string_lossy().to_lowercase();
        if detect_git_bash().is_some() {
            assert!(
                path.ends_with("bash.exe"),
                "探测到 Git Bash 时应使用 bash.exe，实际：{}",
                shell.path.display()
            );
        } else {
            assert!(
                path.ends_with("powershell.exe"),
                "未探测到 Git Bash 时应回退 PowerShell，实际：{}",
                shell.path.display()
            );
        }
    }

    #[test]
    fn profile_from_stored_maps_values() {
        assert_eq!(ShellProfile::from_stored("git_bash"), ShellProfile::GitBash);
        assert_eq!(ShellProfile::from_stored("default"), ShellProfile::Default);
        assert_eq!(ShellProfile::from_stored("unknown"), ShellProfile::Default);
    }
}
