//! 版本检查：匹配当前平台安装包与 SHA256SUMS.txt；端点与路径前缀固定在本模块。

use std::time::Duration;

use git_core::{ErrorCode, Result, UserVisibleError};
use semver::Version;
use serde::{Deserialize, Serialize};
use ureq::config::Config;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};

pub(crate) const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/zyTheGit/gitdock/releases/latest";
pub(crate) const RELEASE_PAGE_PREFIX: &str = "https://github.com/zyTheGit/gitdock/releases/";
pub(crate) const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/zyTheGit/gitdock/releases/download/";
/// GitHub API 拒绝无 User-Agent 的请求，这里必须随请求发出。
pub(crate) const USER_AGENT: &str = "GitDock-desktop";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_RELEASE_NOTES_BYTES: usize = 16 * 1024;
const CHECKSUMS_ASSET_NAME: &str = "SHA256SUMS.txt";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateCheckDto {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    /// 当前版本高于线上最新版。正常发版不会出现，出现即说明安装包的版本号被误标
    /// （例如误 bump 的 3.0.1-rc-2 后来退回了 0.2.x），界面不能只说“已是最新”。
    pub current_newer: bool,
    /// Release 页面（不是安装包直链）：始终保留为浏览器兜底入口。
    pub page_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_size: Option<u64>,
    /// 当前平台+架构命中安装包且 Release 附带 SHA256SUMS.txt 时才允许应用内下载。
    pub can_download: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedUpdateTarget {
    pub version: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_size: u64,
    pub checksums_url: String,
}

#[derive(Debug, Deserialize)]
struct ReleasePayload {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

/// 版本检查用的 HTTPS 客户端（显式指定 NativeTls + PlatformVerifier + https_only）。
pub(crate) fn https_config() -> Config {
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    Config::builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .https_only(true)
        .tls_config(tls)
        .build()
}

pub(crate) fn check_with_target(
    current_version: &str,
) -> Result<(UpdateCheckDto, Option<ResolvedUpdateTarget>)> {
    let agent = https_config().new_agent();
    let body = {
        let mut response = agent
            .get(LATEST_RELEASE_URL)
            .header("User-Agent", USER_AGENT)
            .call()
            .map_err(map_transport_error)?;
        response
            .body_mut()
            .read_to_string()
            .map_err(map_transport_error)?
    };
    parse_release_with_platform(
        &body,
        current_version,
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
}

fn map_transport_error(err: ureq::Error) -> UserVisibleError {
    match err {
        ureq::Error::StatusCode(code) => {
            UserVisibleError::new(ErrorCode::Io, format!("版本信息接口返回状态 {code}"))
                .with_key("errors.updateUnexpectedStatus")
                .with_arg("code", code.to_string())
                .with_detail(
                    "本仓库未公开、还没有任何 Release，或本机 IP 触发了 GitHub 匿名访问限额"
                        .to_string(),
                )
        }
        other => UserVisibleError::new(ErrorCode::Io, "无法获取最新版本信息")
            .with_key("errors.updateFetchFailed")
            .with_detail(other.to_string()),
    }
}

pub(crate) fn match_platform_asset<'a>(
    assets: &'a [ReleaseAsset],
    os: &str,
    arch: &str,
) -> Option<&'a ReleaseAsset> {
    let suffix = match (os, arch) {
        ("windows", "x86_64") => "-setup.exe",
        ("macos", "aarch64") => "_aarch64.dmg",
        ("linux", "x86_64") => "_amd64.deb",
        _ => return None,
    };
    assets.iter().find(|asset| asset.name.ends_with(suffix))
}

/// 纯解析：与网络及当前平台解耦，便于用固定 JSON 覆盖各平台匹配与校验分支。
pub(crate) fn parse_release_with_platform(
    body: &str,
    current_version: &str,
    os: &str,
    arch: &str,
) -> Result<(UpdateCheckDto, Option<ResolvedUpdateTarget>)> {
    let release: ReleasePayload = serde_json::from_str(body).map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "版本信息格式异常")
            .with_key("errors.updateFormatInvalid")
            .with_detail(err.to_string())
    })?;
    if !is_pinned_release_page(&release.html_url) {
        return Err(off_repo_error());
    }
    let latest = parse_version(&release.tag_name)?;
    let current = parse_version(current_version)?;

    let matched_asset = match_platform_asset(&release.assets, os, arch)
        .filter(|asset| is_pinned_download_url(&asset.browser_download_url));
    let matched_checksums = release
        .assets
        .iter()
        .find(|asset| asset.name == CHECKSUMS_ASSET_NAME)
        .filter(|asset| is_pinned_download_url(&asset.browser_download_url));

    let target = match (matched_asset, matched_checksums) {
        (Some(asset), Some(checksums)) => Some(ResolvedUpdateTarget {
            version: latest.to_string(),
            asset_name: asset.name.clone(),
            asset_url: asset.browser_download_url.clone(),
            asset_size: asset.size,
            checksums_url: checksums.browser_download_url.clone(),
        }),
        _ => None,
    };

    let dto = UpdateCheckDto {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        available: latest > current,
        current_newer: latest < current,
        page_url: release.html_url,
        published_at: normalize_published_at(release.published_at),
        release_notes: normalize_release_notes(release.body),
        asset_name: target.as_ref().map(|item| item.asset_name.clone()),
        asset_size: target.as_ref().map(|item| item.asset_size),
        can_download: target.is_some(),
    };
    Ok((dto, target))
}

fn parse_version(value: &str) -> Result<Version> {
    Version::parse(value.trim().trim_start_matches('v')).map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "版本号无法解析")
            .with_key("errors.updateVersionParseFailed")
            .with_detail(err.to_string())
    })
}

fn normalize_published_at(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let date = raw.split('T').next().unwrap_or_default();
        (!date.is_empty()).then(|| date.to_owned())
    })
}

fn normalize_release_notes(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_owned();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() <= MAX_RELEASE_NOTES_BYTES {
        return Some(trimmed);
    }
    let mut end = MAX_RELEASE_NOTES_BYTES;
    while end > 0 && !trimmed.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!("{}…", trimmed[..end].trim_end()))
}

fn is_pinned_release_page(url: &str) -> bool {
    url.starts_with(RELEASE_PAGE_PREFIX)
}

pub(crate) fn is_pinned_download_url(url: &str) -> bool {
    url.starts_with(RELEASE_DOWNLOAD_PREFIX)
}

fn off_repo_error() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "下载地址不属于本仓库的发布页")
        .with_key("errors.updateUrlNotInRepo")
}

/// command 层复用：界面回传 URL 时同样在 Rust 侧校验，不依赖前端判断。
pub fn ensure_release_page(url: &str) -> Result<()> {
    if is_pinned_release_page(url) {
        Ok(())
    } else {
        Err(off_repo_error())
    }
}
