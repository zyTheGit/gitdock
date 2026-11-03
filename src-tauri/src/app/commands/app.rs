//! 应用域 command：版本信息、反馈入口、更新检查与主窗口就绪。

use std::sync::Arc;

use git_core::{ErrorCode, Result, UserVisibleError};
use git_read::{detect_git_version, MINIMUM_GIT_VERSION};
use serde::Serialize;
use tauri::State;

use super::{blocking, Shared};
use crate::app::update::{self, UpdateCheckDto};

#[derive(Debug, Serialize)]
pub struct AppInfoDto {
    pub app_version: String,
    pub git_version: Option<String>,
    pub git_version_supported: bool,
    pub minimum_git_version: String,
    pub config_dir: String,
    pub log_path: String,
    pub platform: String,
}

#[tauri::command]
pub async fn app_info(state: State<'_, Shared>) -> Result<AppInfoDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let (git_version, git_version_supported) = detect_git_version();
        Ok(AppInfoDto {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            git_version,
            git_version_supported,
            minimum_git_version: MINIMUM_GIT_VERSION.to_owned(),
            config_dir: state.paths.config_dir.display().to_string(),
            log_path: state.paths.log_path.display().to_string(),
            platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        })
    })
    .await
}

const FEEDBACK_ISSUE_URL: &str = "https://github.com/zyTheGit/gitdock/issues/new";
const MAX_FEEDBACK_TITLE_CHARS: usize = 120;
const MAX_FEEDBACK_BODY_CHARS: usize = 8000;

/// 反馈入口只接受标题与正文，目标地址固定；由后端拼 query，前端不能指定 URL 或协议。
fn feedback_issue_url(title: &str, body: &str) -> Result<String> {
    let title = title.trim();
    if title.is_empty() {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "反馈标题不能为空")
                .with_key("errors.feedbackTitleRequired"),
        );
    }
    if title.chars().count() > MAX_FEEDBACK_TITLE_CHARS
        || body.chars().count() > MAX_FEEDBACK_BODY_CHARS
    {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "反馈内容过长，请精简后再提交",
        )
        .with_key("errors.feedbackTooLong"));
    }
    let mut url = tauri::Url::parse(FEEDBACK_ISSUE_URL).map_err(|e| {
        UserVisibleError::internal(format!("反馈地址无效：{e}"))
            .with_key("errors.feedbackUrlInvalid")
            .with_arg("error", e.to_string())
    })?;
    url.query_pairs_mut()
        .append_pair("title", title)
        .append_pair("body", body);
    Ok(url.to_string())
}

#[tauri::command]
pub fn open_feedback_issue(title: String, body: String) -> Result<()> {
    let url = feedback_issue_url(&title, &body)?;
    crate::app::external::open_url(&url)
}

/// 检查远端是否有新版本。只读比较，不下载也不安装；下载地址由后端返回，
/// 前端拿到的仍是固定在本仓库 Release 页内的 URL。
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheckDto> {
    blocking(move || update::check(env!("CARGO_PKG_VERSION"))).await
}

/// 用系统浏览器打开发布页。地址虽由界面回传，仍在 Rust 侧按前缀校验，
/// 界面无法把“打开”指向任意 URL 或协议。
#[tauri::command]
pub fn open_release_page(url: String) -> Result<()> {
    update::ensure_release_page(&url)?;
    crate::app::external::open_url(&url)
}

/// 前端完成首帧后再显示主窗口：窗口在配置里保持隐藏，避免启动时先按默认尺寸
/// 出现、再跳成保存的尺寸，以及 WebView2 未绘制前的白底闪帧。
#[tauri::command]
pub fn ui_ready(window: tauri::WebviewWindow) -> Result<()> {
    window.show().map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "显示主窗口失败")
            .with_key("errors.windowShowFailed")
            .with_detail(err.to_string())
    })?;
    let _ = window.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feedback_url_uses_fixed_repository_and_encodes_content() {
        let url = feedback_issue_url("标题 & bug", "第一行\n第二行 https://x.test?a=1").unwrap();
        assert!(url.starts_with("https://github.com/zyTheGit/gitdock/issues/new?"));
        assert!(url.contains("title=%E6%A0%87%E9%A2%98+%26+bug"));
        assert!(url.contains("body="));
        // 换行与正文里的问号、冒号都必须留在 query 内，不能改变 URL 结构。
        assert!(!url.contains('\n'));
        assert!(url.contains("%0A"));
        assert!(url.contains("%3A%2F%2F"));
    }

    #[test]
    fn feedback_url_rejects_empty_title_and_oversized_content() {
        assert_eq!(
            feedback_issue_url("   ", "body").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        let long = "字".repeat(MAX_FEEDBACK_BODY_CHARS + 1);
        assert_eq!(
            feedback_issue_url("title", &long).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
}
