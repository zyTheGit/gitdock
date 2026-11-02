//! 版本检查：只回答“有没有新版本”，下载安装仍由用户在浏览器里完成。
//!
//! 端点与协议都固定写在本模块（HTTPS + 本仓库），前端不能指定地址，因此这个
//! command 不会被当成通用 HTTP 代理。响应里的 Release 页面地址在返回前还要
//! 校验一次前缀，避免远端把“打开链接”指向站外。

use std::time::Duration;

use git_core::{ErrorCode, Result, UserVisibleError};
use semver::Version;
use serde::{Deserialize, Serialize};
use ureq::config::Config;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/zyTheGit/gitdock/releases/latest";
const RELEASE_PAGE_PREFIX: &str = "https://github.com/zyTheGit/gitdock/releases/";
/// GitHub API 拒绝无 User-Agent 的请求，这里必须随请求发出。
const USER_AGENT: &str = "GitDock-desktop";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateCheckDto {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    /// Release 页面（不是安装包直链）：由系统浏览器打开，用户自己选择下载。
    pub page_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ReleasePayload {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
}

/// 版本检查用的 HTTPS 客户端。
///
/// ureq 不会因为编入了 `native-tls` 就自动使用它：provider 必须在 `TlsConfig` 里
/// 显式设置，否则 https 请求在连接阶段直接 panic（“provider is Rustls but feature
/// is not enabled”），而默认 provider 恰好是未编入的 rustls。根证书走 Windows
/// 证书库，不打包 Mozilla webpki 根。
fn https_config() -> Config {
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    Config::builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .tls_config(tls)
        .build()
}

pub fn check(current_version: &str) -> Result<UpdateCheckDto> {
    let agent = https_config().new_agent();
    let body = {
        let mut response = agent
            .get(LATEST_RELEASE_URL)
            .header("User-Agent", USER_AGENT)
            .call()
            .map_err(map_transport_error)?;
        // ureq 3：非 2xx 直接报错，响应体读取上限 10 MB。
        response
            .body_mut()
            .read_to_string()
            .map_err(map_transport_error)?
    };
    parse_release(&body, current_version)
}

/// 传输层失败一律归到 `Io`。状态码单独成句：ureq 默认只给“状态码 403”，而这个码
/// 在 GitHub 上有多种可解释的成因，需要一并写出来供日志排查。
fn map_transport_error(err: ureq::Error) -> UserVisibleError {
    match err {
        ureq::Error::StatusCode(code) => {
            UserVisibleError::new(ErrorCode::Io, format!("版本信息接口返回状态 {code}"))
                .with_detail(
                    "本仓库未公开、还没有任何 Release，或本机 IP 触发了 GitHub 匿名访问限额"
                        .to_string(),
                )
        }
        other => UserVisibleError::new(ErrorCode::Io, "无法获取最新版本信息")
            .with_detail(other.to_string()),
    }
}

/// 纯解析：与网络无关，便于用固定 JSON 覆盖各版本比较分支。
fn parse_release(body: &str, current_version: &str) -> Result<UpdateCheckDto> {
    let release: ReleasePayload = serde_json::from_str(body).map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "版本信息格式异常").with_detail(err.to_string())
    })?;
    if !is_pinned_release_page(&release.html_url) {
        return Err(off_repo_error());
    }
    let latest = parse_version(&release.tag_name)?;
    let current = parse_version(current_version)?;
    Ok(UpdateCheckDto {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        available: latest > current,
        page_url: release.html_url,
        published_at: normalize_published_at(release.published_at),
    })
}

/// 标签允许 `v0.2.0` 与 `0.2.0` 两种写法；其余一律拒绝，不做模糊比较。
fn parse_version(value: &str) -> Result<Version> {
    Version::parse(value.trim().trim_start_matches('v')).map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "版本号无法解析").with_detail(err.to_string())
    })
}

/// API 返回 `2026-11-02T06:40:11Z`，界面只需要日期部分。
fn normalize_published_at(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let date = raw.split('T').next().unwrap_or_default();
        (!date.is_empty()).then(|| date.to_owned())
    })
}

/// Release 页面必须落在本仓库的 releases 路径内。前缀已含协议与主机名，
/// 所以 `releases/../..` 这类路径技巧也跳不出 github.com 上的本页范围。
fn is_pinned_release_page(url: &str) -> bool {
    url.starts_with(RELEASE_PAGE_PREFIX)
}

fn off_repo_error() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "下载地址不属于本仓库的发布页")
}

/// command 层复用：界面回传 URL 时同样在 Rust 侧校验，不依赖前端判断。
pub fn ensure_release_page(url: &str) -> Result<()> {
    if is_pinned_release_page(url) {
        Ok(())
    } else {
        Err(off_repo_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(tag: &str, url: &str) -> String {
        format!(
            r#"{{"tag_name":"{tag}","html_url":"{url}","published_at":"2026-11-02T06:40:11Z"}}"#
        )
    }

    /// 回归：漏掉 provider 时 https 请求会在连接阶段 panic，编译和其余测试全绿也发现不了。
    #[test]
    fn https_config_selects_the_compiled_tls_provider() {
        let tls = https_config().tls_config().clone();
        assert_eq!(tls.provider(), TlsProvider::NativeTls);
        assert!(matches!(tls.root_certs(), RootCerts::PlatformVerifier));
    }

    const PAGE: &str = "https://github.com/zyTheGit/gitdock/releases/tag/v0.2.0";

    #[test]
    fn release_endpoint_is_pinned_to_this_repository() {
        // 仓库改名或转私有会让检查静默失效，端点漂移必须在这里先失败。
        assert_eq!(
            LATEST_RELEASE_URL,
            "https://api.github.com/repos/zyTheGit/gitdock/releases/latest"
        );
    }

    #[test]
    fn newer_tag_strips_prefix_and_reports_update_available() {
        let dto = parse_release(&payload("v0.2.0", PAGE), "0.1.0").expect("解析失败");
        assert!(dto.available);
        assert_eq!(dto.latest_version, "0.2.0");
        assert_eq!(dto.current_version, "0.1.0");
        assert_eq!(dto.page_url, PAGE);
        assert_eq!(dto.published_at.as_deref(), Some("2026-11-02"));
    }

    #[test]
    fn same_version_reports_no_update() {
        let dto = parse_release(&payload("0.1.0", PAGE), "0.1.0").expect("解析失败");
        assert!(!dto.available);
    }

    #[test]
    fn older_tag_never_prompts_downgrade() {
        let dto = parse_release(&payload("v0.1.0", PAGE), "0.2.0").expect("解析失败");
        assert!(!dto.available);
    }

    #[test]
    fn prerelease_tag_is_not_offered_as_newer() {
        let dto = parse_release(&payload("v0.2.0-rc.1", PAGE), "0.2.0").expect("解析失败");
        assert!(!dto.available);
    }

    #[test]
    fn two_digit_component_outperforms_lexical_compare() {
        let dto = parse_release(&payload("v0.10.0", PAGE), "0.9.0").expect("解析失败");
        assert!(dto.available);
    }

    #[test]
    fn malformed_tag_is_rejected() {
        let err =
            parse_release(&payload("nightly-2026", PAGE), "0.1.0").expect_err("应拒绝非 semver");
        assert_eq!(err.code, ErrorCode::Internal);
    }

    #[test]
    fn non_json_body_is_rejected() {
        let err = parse_release("<html>rate limited</html>", "0.1.0").expect_err("应拒绝非 JSON");
        assert_eq!(err.code, ErrorCode::Internal);
    }

    #[test]
    fn release_url_outside_repository_is_rejected() {
        let body = payload("v0.2.0", "https://example.test/evil.exe");
        let err = parse_release(&body, "0.1.0").expect_err("应拒绝站外下载地址");
        assert_eq!(err.code, ErrorCode::Internal);
    }

    #[test]
    fn opened_page_is_validated_on_the_rust_side() {
        assert!(ensure_release_page(PAGE).is_ok());
        // 同一仓库的资产下载页同样允许。
        assert!(ensure_release_page(
            "https://github.com/zyTheGit/gitdock/releases/download/v0.2.0/a.exe"
        )
        .is_ok());
        for rejected in [
            // 改名前的仓库地址。
            "https://github.com/zyTheGit/git-graph/releases/tag/v0.1.0",
            // 主机名后缀伪装与协议降级。
            "https://github.com.evil.test/zyTheGit/gitdock/releases/tag/v0.2.0",
            "http://github.com/zyTheGit/gitdock/releases/tag/v0.2.0",
            "file:///C:/Windows/System32/calc.exe",
        ] {
            let err = ensure_release_page(rejected).expect_err("应拒绝非本仓库发布页");
            assert_eq!(err.code, ErrorCode::Internal);
        }
    }
}
