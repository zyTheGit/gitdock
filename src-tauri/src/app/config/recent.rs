//! 最近仓库列表：规范化路径、去重与移除。

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use git_core::{ErrorCode, UserVisibleError};
use serde::{Deserialize, Serialize};

use super::SettingsDto;
use crate::app::platform::same_path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentRepository {
    pub path: String,
    pub last_opened_at: i64,
}

pub fn remember(
    dir: &Path,
    current: &SettingsDto,
    path: &Path,
) -> Result<SettingsDto, UserVisibleError> {
    let canonical = std::fs::canonicalize(path).map_err(|e| {
        UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不可访问")
            .with_key("errors.repoDirInaccessible")
            .with_detail(e.to_string())
    })?;
    if !canonical.is_dir() {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "仓库路径必须是目录")
                .with_key("errors.repoPathMustBeDirectory"),
        );
    }
    let text = strip_verbatim(&canonical);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let mut settings = current.clone();
    settings
        .recent_repositories
        .retain(|entry| !same_path(&entry.path, &text));
    settings.recent_repositories.insert(
        0,
        RecentRepository {
            path: text,
            last_opened_at: now,
        },
    );
    super::save(dir, &settings)
}

/// 仅从最近仓库列表移除，不触碰磁盘上的仓库目录。
pub fn forget(
    dir: &Path,
    current: &SettingsDto,
    path: &str,
) -> Result<SettingsDto, UserVisibleError> {
    let mut settings = current.clone();
    settings
        .recent_repositories
        .retain(|entry| !same_path(&entry.path, path));
    super::save(dir, &settings)
}

/// Windows 的 canonicalize 会返回 `\\?\` 扩展前缀；最近仓库列表需要展示用户熟悉的路径。
pub(crate) fn strip_verbatim(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text.into_owned()
    }
}
