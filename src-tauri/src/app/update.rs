//! 版本检查与更新安装包下载协调器（方案 A，ADR-0040）。

mod check;
mod download;
#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use git_core::{ErrorCode, Result, UserVisibleError};
use semver::Version;
use serde::Serialize;
use tauri::Emitter;

pub use check::{ensure_release_page, UpdateCheckDto};
pub use download::EVENT_UPDATE_DOWNLOAD_PROGRESS;

use crate::app::logging;
use crate::app::platform::InstallerLaunchMode;
use check::ResolvedUpdateTarget;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateDownloadProgressDto {
    pub version: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateDownloadResultDto {
    pub version: String,
    pub file_name: String,
    pub file_path: String,
    pub sha256: String,
    pub size: u64,
}

/// 启动清理：删掉残留 `.part` 文件，并移除 `<= current_version` 的旧更新缓存目录；
/// 高于当前版本的已校验安装包保留，避免用户重启前刚下载完却被清空。
pub fn cleanup_cache(root: &Path, current_version: &str) {
    let current = Version::parse(current_version.trim().trim_start_matches('v')).ok();
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(err) => {
            logging::warn(&format!("读取更新缓存目录失败：{err}"));
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        let dir_name = entry.file_name();
        let parsed = dir_name
            .to_str()
            .and_then(|name| Version::parse(name.trim_start_matches('v')).ok());
        let stale = match (parsed, current.as_ref()) {
            (Some(ver), Some(cur)) => ver <= *cur,
            _ => true,
        };
        if stale {
            let _ = std::fs::remove_dir_all(&path);
        } else if let Ok(sub) = std::fs::read_dir(&path) {
            for item in sub.flatten() {
                if item.path().extension().and_then(|e| e.to_str()) == Some("part") {
                    let _ = std::fs::remove_file(item.path());
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInstallDto {
    pub mode: InstallerLaunchMode,
    pub file_path: String,
    pub file_name: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DownloadedArtifact {
    pub file_name: String,
    pub file_path: PathBuf,
}

/// 持有最近一次检查到的平台安装包与当前下载任务状态，不从前端接受任意 URL/路径。
#[derive(Default)]
pub struct UpdateManager {
    latest: Mutex<Option<ResolvedUpdateTarget>>,
    downloaded: Mutex<Option<DownloadedArtifact>>,
    active_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

struct CancelSlotGuard<'a>(&'a Mutex<Option<Arc<AtomicBool>>>);

impl Drop for CancelSlotGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
    }
}

impl UpdateManager {
    pub fn check_and_record(&self, current_version: &str) -> Result<UpdateCheckDto> {
        let (dto, target) = check::check_with_target(current_version)?;
        if let Ok(mut guard) = self.latest.lock() {
            *guard = target;
        }
        Ok(dto)
    }

    pub fn start_download(
        &self,
        app: &tauri::AppHandle,
        cache_root: &Path,
        current_version: &str,
    ) -> Result<UpdateDownloadResultDto> {
        let cancel = {
            let mut guard = self
                .active_cancel
                .lock()
                .map_err(|_| UserVisibleError::new(ErrorCode::Internal, "更新下载锁不可用"))?;
            if guard.is_some() {
                return Err(UserVisibleError::new(
                    ErrorCode::InvalidArgument,
                    "已有更新下载正在进行中",
                )
                .with_key("errors.updateDownloadBusy"));
            }
            let flag = Arc::new(AtomicBool::new(false));
            *guard = Some(Arc::clone(&flag));
            flag
        };
        let _slot_guard = CancelSlotGuard(&self.active_cancel);

        let existing_target = self.latest.lock().ok().and_then(|guard| guard.clone());
        let target = match existing_target {
            Some(target) => target,
            None => {
                let (_, resolved) = check::check_with_target(current_version)?;
                if let Ok(mut guard) = self.latest.lock() {
                    *guard = resolved.clone();
                }
                resolved.ok_or_else(|| {
                    UserVisibleError::new(
                        ErrorCode::InvalidArgument,
                        "当前平台暂不支持应用内下载，请改用浏览器打开下载页",
                    )
                    .with_key("errors.updateAssetUnavailable")
                })?
            }
        };

        let (file_path, sha256, size) =
            download::download_and_verify(&target, cache_root, &cancel, |progress| {
                let _ = app.emit(EVENT_UPDATE_DOWNLOAD_PROGRESS, &progress);
            })?;

        if let Ok(mut guard) = self.downloaded.lock() {
            *guard = Some(DownloadedArtifact {
                file_name: target.asset_name.clone(),
                file_path: file_path.clone(),
            });
        }

        Ok(UpdateDownloadResultDto {
            version: target.version,
            file_name: target.asset_name,
            file_path: file_path.display().to_string(),
            sha256,
            size,
        })
    }

    pub fn cancel(&self) {
        if let Ok(guard) = self.active_cancel.lock() {
            if let Some(flag) = guard.as_ref() {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    pub(crate) fn downloaded_file(&self) -> Result<DownloadedArtifact> {
        let guard = self
            .downloaded
            .lock()
            .map_err(|_| UserVisibleError::new(ErrorCode::Internal, "读取已下载安装包状态失败"))?;
        guard.clone().ok_or_else(|| {
            UserVisibleError::new(ErrorCode::InvalidArgument, "尚未完成更新包下载")
                .with_key("errors.updateFileMissing")
        })
    }
}
