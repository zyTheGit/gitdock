//! 更新安装包流式下载、重定向白名单与 SHA-256 严格校验（ADR-0040）。

use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use git_core::{ErrorCode, Result, UserVisibleError};
use sha2::{Digest, Sha256};
use ureq::config::Config;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use ureq::Agent;

use super::check::{is_pinned_download_url, ResolvedUpdateTarget, USER_AGENT};
use super::UpdateDownloadProgressDto;

pub const EVENT_UPDATE_DOWNLOAD_PROGRESS: &str = "update-download-progress";

const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
const MAX_CHECKSUMS_BYTES: usize = 64 * 1024;
const MAX_REDIRECT_HOPS: usize = 5;
const CHUNK_SIZE: usize = 32 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);
const PROGRESS_MIN_BYTES: u64 = 256 * 1024;

fn download_https_config() -> Config {
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    Config::builder()
        .https_only(true)
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(20)))
        .timeout_recv_body(Some(Duration::from_secs(600)))
        .tls_config(tls)
        .build()
}

pub(crate) fn is_allowed_download_url(raw: &str) -> bool {
    let Ok(url) = tauri::Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let lower = host.to_ascii_lowercase();
    lower == "github.com" || lower.ends_with(".githubusercontent.com")
}

fn get_following_allowed_redirects(
    agent: &Agent,
    initial_url: &str,
) -> Result<ureq::http::Response<ureq::Body>> {
    if !is_pinned_download_url(initial_url) || !is_allowed_download_url(initial_url) {
        return Err(
            UserVisibleError::new(ErrorCode::Internal, "下载地址不在本仓库白名单内")
                .with_key("errors.updateUrlNotInRepo"),
        );
    }
    let mut current = initial_url.to_owned();
    for _ in 0..=MAX_REDIRECT_HOPS {
        let response = agent
            .get(&current)
            .header("User-Agent", USER_AGENT)
            .call()
            .map_err(|err| {
                UserVisibleError::new(ErrorCode::Io, "下载更新失败")
                    .with_key("errors.updateDownloadFailed")
                    .with_detail(err.to_string())
            })?;
        let status = response.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            let location = response
                .headers()
                .get("location")
                .and_then(|val| val.to_str().ok())
                .ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::Io, "下载重定向缺少目标地址")
                        .with_key("errors.updateRedirectRejected")
                })?;
            let resolved = tauri::Url::parse(&current)
                .and_then(|base| base.join(location))
                .map(|url| url.to_string())
                .map_err(|err| {
                    UserVisibleError::new(ErrorCode::Io, "下载重定向地址无效")
                        .with_key("errors.updateRedirectRejected")
                        .with_detail(err.to_string())
                })?;
            if !is_allowed_download_url(&resolved) {
                return Err(UserVisibleError::new(
                    ErrorCode::Internal,
                    "下载重定向指向非白名单域名",
                )
                .with_key("errors.updateRedirectRejected"));
            }
            current = resolved;
            continue;
        }
        if (200..300).contains(&status) {
            return Ok(response);
        }
        return Err(UserVisibleError::new(
            ErrorCode::Io,
            format!("下载更新服务器返回状态 {status}"),
        )
        .with_key("errors.updateDownloadFailed")
        .with_detail(format!("HTTP {status}")));
    }
    Err(
        UserVisibleError::new(ErrorCode::Io, "下载更新重定向次数过多")
            .with_key("errors.updateRedirectRejected"),
    )
}

pub(crate) fn parse_sha256sums(text: &str, filename: &str) -> Option<String> {
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let hash = parts.next()?.trim();
        let entry = parts.next()?.trim().trim_start_matches('*');
        if entry != filename {
            continue;
        }
        if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

pub(crate) fn safe_asset_filename(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.chars().any(char::is_control)
    {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "安装包文件名非法")
                .with_key("errors.updateInvalidAssetName"),
        );
    }
    Ok(trimmed.to_owned())
}

pub(crate) fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|err| {
        UserVisibleError::new(ErrorCode::Io, "读取已下载安装包失败")
            .with_key("errors.updateIoFailed")
            .with_detail(err.to_string())
    })?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; CHUNK_SIZE];
    loop {
        let read = file.read(&mut buf).map_err(|err| {
            UserVisibleError::new(ErrorCode::Io, "校验已下载安装包失败")
                .with_key("errors.updateIoFailed")
                .with_detail(err.to_string())
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex_encode(&hasher.finalize()))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

pub(crate) fn download_and_verify(
    target: &ResolvedUpdateTarget,
    cache_root: &Path,
    cancel: &AtomicBool,
    on_progress: impl Fn(UpdateDownloadProgressDto),
) -> Result<(PathBuf, String, u64)> {
    let safe_name = safe_asset_filename(&target.asset_name)?;
    let version_dir = cache_root.join(&target.version);
    std::fs::create_dir_all(&version_dir).map_err(|err| {
        UserVisibleError::new(ErrorCode::Io, "创建更新缓存目录失败")
            .with_key("errors.updateIoFailed")
            .with_detail(err.to_string())
    })?;

    let agent = download_https_config().new_agent();
    let checksums_text = fetch_checksums(&agent, &target.checksums_url)?;
    let expected_hash = parse_sha256sums(&checksums_text, &safe_name).ok_or_else(|| {
        UserVisibleError::new(
            ErrorCode::Internal,
            "SHA256SUMS.txt 中未找到对应安装包的校验值",
        )
        .with_key("errors.updateChecksumMissing")
    })?;

    let final_path = version_dir.join(&safe_name);
    if final_path.is_file() {
        if let Ok(existing_hash) = sha256_file(&final_path) {
            if existing_hash == expected_hash {
                let size = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
                on_progress(UpdateDownloadProgressDto {
                    version: target.version.clone(),
                    phase: "ready".to_owned(),
                    downloaded_bytes: size,
                    total_bytes: Some(size),
                });
                return Ok((final_path, existing_hash, size));
            }
        }
        let _ = std::fs::remove_file(&final_path);
    }

    let part_path = version_dir.join(format!("{safe_name}.part"));
    let _ = std::fs::remove_file(&part_path);
    let outcome = stream_to_part(
        &agent,
        target,
        &part_path,
        &expected_hash,
        cancel,
        &on_progress,
    );
    let (computed_hash, total_written) = match outcome {
        Ok(pair) => pair,
        Err(err) => {
            let _ = std::fs::remove_file(&part_path);
            return Err(err);
        }
    };

    if final_path.exists() {
        let _ = std::fs::remove_file(&final_path);
    }
    if let Err(err) = std::fs::rename(&part_path, &final_path) {
        let _ = std::fs::remove_file(&part_path);
        return Err(UserVisibleError::new(ErrorCode::Io, "保存更新安装包失败")
            .with_key("errors.updateIoFailed")
            .with_detail(err.to_string()));
    }

    on_progress(UpdateDownloadProgressDto {
        version: target.version.clone(),
        phase: "ready".to_owned(),
        downloaded_bytes: total_written,
        total_bytes: Some(total_written),
    });
    Ok((final_path, computed_hash, total_written))
}

fn fetch_checksums(agent: &Agent, url: &str) -> Result<String> {
    let mut response = get_following_allowed_redirects(agent, url)?;
    let mut buf = Vec::new();
    let mut limited = response
        .body_mut()
        .as_reader()
        .take((MAX_CHECKSUMS_BYTES + 1) as u64);
    limited.read_to_end(&mut buf).map_err(|err| {
        UserVisibleError::new(ErrorCode::Io, "读取 SHA256SUMS.txt 失败")
            .with_key("errors.updateDownloadFailed")
            .with_detail(err.to_string())
    })?;
    if buf.len() > MAX_CHECKSUMS_BYTES {
        return Err(
            UserVisibleError::new(ErrorCode::Internal, "SHA256SUMS.txt 体积超出限制")
                .with_key("errors.updateFileTooLarge"),
        );
    }
    String::from_utf8(buf).map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "SHA256SUMS.txt 编码无效")
            .with_key("errors.updateFormatInvalid")
            .with_detail(err.to_string())
    })
}

fn stream_to_part(
    agent: &Agent,
    target: &ResolvedUpdateTarget,
    part_path: &Path,
    expected_hash: &str,
    cancel: &AtomicBool,
    on_progress: &impl Fn(UpdateDownloadProgressDto),
) -> Result<(String, u64)> {
    let mut response = get_following_allowed_redirects(agent, &target.asset_url)?;
    let header_len = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let total_bytes = header_len.or((target.asset_size > 0).then_some(target.asset_size));
    if let Some(len) = total_bytes {
        if len > MAX_DOWNLOAD_BYTES {
            return Err(UserVisibleError::new(
                ErrorCode::Internal,
                "安装包体积超过 200 MB 安全上限",
            )
            .with_key("errors.updateFileTooLarge"));
        }
    }

    let file = File::create(part_path).map_err(|err| {
        UserVisibleError::new(ErrorCode::Io, "创建更新临时文件失败")
            .with_key("errors.updateIoFailed")
            .with_detail(err.to_string())
    })?;
    let mut writer = BufWriter::new(file);
    let mut hasher = Sha256::new();
    let mut reader = response.body_mut().as_reader();
    let mut buf = [0u8; CHUNK_SIZE];
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_emit_bytes: u64 = 0;

    on_progress(UpdateDownloadProgressDto {
        version: target.version.clone(),
        phase: "downloading".to_owned(),
        downloaded_bytes: 0,
        total_bytes,
    });

    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(UserVisibleError::new(ErrorCode::Canceled, "已取消下载更新")
                .with_key("errors.updateDownloadCancelled"));
        }
        let read = reader.read(&mut buf).map_err(|err| {
            UserVisibleError::new(ErrorCode::Io, "下载更新数据包中断")
                .with_key("errors.updateDownloadFailed")
                .with_detail(err.to_string())
        })?;
        if read == 0 {
            break;
        }
        downloaded = downloaded.saturating_add(read as u64);
        if downloaded > MAX_DOWNLOAD_BYTES {
            return Err(UserVisibleError::new(
                ErrorCode::Internal,
                "安装包体积超过 200 MB 安全上限",
            )
            .with_key("errors.updateFileTooLarge"));
        }
        writer.write_all(&buf[..read]).map_err(|err| {
            UserVisibleError::new(ErrorCode::Io, "写入更新临时文件失败")
                .with_key("errors.updateIoFailed")
                .with_detail(err.to_string())
        })?;
        hasher.update(&buf[..read]);

        if last_emit.elapsed() >= PROGRESS_INTERVAL
            || downloaded.saturating_sub(last_emit_bytes) >= PROGRESS_MIN_BYTES
        {
            last_emit = Instant::now();
            last_emit_bytes = downloaded;
            on_progress(UpdateDownloadProgressDto {
                version: target.version.clone(),
                phase: "downloading".to_owned(),
                downloaded_bytes: downloaded,
                total_bytes,
            });
        }
    }

    writer.flush().map_err(|err| {
        UserVisibleError::new(ErrorCode::Io, "刷新更新临时文件失败")
            .with_key("errors.updateIoFailed")
            .with_detail(err.to_string())
    })?;

    on_progress(UpdateDownloadProgressDto {
        version: target.version.clone(),
        phase: "verifying".to_owned(),
        downloaded_bytes: downloaded,
        total_bytes: total_bytes.or(Some(downloaded)),
    });

    let computed = hex_encode(&hasher.finalize());
    if computed != expected_hash {
        return Err(UserVisibleError::new(
            ErrorCode::Internal,
            "安装包 SHA-256 校验失败，已删除损坏文件",
        )
        .with_key("errors.updateChecksumMismatch"));
    }
    Ok((computed, downloaded))
}
