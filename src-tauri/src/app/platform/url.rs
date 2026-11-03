//! 用系统默认浏览器打开 URL：三平台分派（自 external.rs 迁入，ADR-0005）。

use git_core::process::hide_console;
use git_core::{ErrorCode, Result, UserVisibleError};

/// 打开 URL。跨进程行为按平台选择系统 opener；URL 必须由后端按固定模板
/// 构造，不接受前端任意协议。错误统一走 `errors.externalBrowserOpenFailed`。
pub(crate) fn open_url(url: &str) -> Result<()> {
    #[cfg(windows)]
    let (program, args): (&str, Vec<&str>) =
        ("rundll32.exe", vec!["url.dll,FileProtocolHandler", url]);
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![url]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![url]);
    let mut command = std::process::Command::new(program);
    command.args(args);
    hide_console(&mut command);
    command.spawn().map(|_| ()).map_err(|e| {
        UserVisibleError::new(ErrorCode::ExternalToolFailed, "打开默认浏览器失败")
            .with_key("errors.externalBrowserOpenFailed")
            .with_detail(e.to_string())
    })
}
