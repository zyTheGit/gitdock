//! 更新安装包的三平台启动/定位衔接（ADR-0005 / ADR-0040）。

use std::path::Path;

use git_core::{ErrorCode, Result, UserVisibleError};
use serde::Serialize;

/// 平台执行安装衔接后的反馈语义，前端据此决定提示文案与后续状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum InstallerLaunchMode {
    /// Windows：已拉起 NSIS 安装向导，应用随后自动退出以释放可执行文件锁。
    LaunchedExit,
    /// macOS：已调用 `open` 挂载并打开 DMG 镜像窗口。
    Opened,
    /// Linux：已在文件管理器中定位 `.deb` 包，由用户按提示命令安装。
    Revealed,
}

/// 按当前平台启动或定位已校验的安装包。
pub(crate) fn launch_installer(path: &Path) -> Result<InstallerLaunchMode> {
    if !path.is_file() {
        return Err(
            UserVisibleError::new(ErrorCode::Io, "未找到已下载的更新安装包")
                .with_key("errors.updateFileMissing"),
        );
    }
    platform_launch(path)
}

#[cfg(windows)]
fn platform_launch(path: &Path) -> Result<InstallerLaunchMode> {
    std::process::Command::new(path).spawn().map_err(|e| {
        UserVisibleError::new(ErrorCode::ExternalToolFailed, "启动更新安装程序失败")
            .with_key("errors.updateInstallLaunchFailed")
            .with_detail(e.to_string())
    })?;
    Ok(InstallerLaunchMode::LaunchedExit)
}

#[cfg(target_os = "macos")]
fn platform_launch(path: &Path) -> Result<InstallerLaunchMode> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| {
            UserVisibleError::new(ErrorCode::ExternalToolFailed, "打开更新镜像失败")
                .with_key("errors.updateInstallLaunchFailed")
                .with_detail(e.to_string())
        })?;
    Ok(InstallerLaunchMode::Opened)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_launch(path: &Path) -> Result<InstallerLaunchMode> {
    super::reveal(path)?;
    Ok(InstallerLaunchMode::Revealed)
}
