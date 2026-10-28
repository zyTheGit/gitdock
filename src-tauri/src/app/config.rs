//! 应用配置：平台配置目录下的 settings.json（含 schema version）。
//! 仅本模块与 Tauri command 层接触该文件；前端只拿到结构化 DTO。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git_core::{ErrorCode, UserVisibleError};
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;
const MAX_RECENT: usize = 10;
const MAX_TEMPLATE_LEN: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentRepository {
    pub path: String,
    pub last_opened_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalToolConfig {
    pub name: String,
    pub executable: String,
    pub args_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsDto {
    pub schema_version: u32,
    pub recent_repositories: Vec<RecentRepository>,
    pub external_tools: Vec<ExternalToolConfig>,
    pub restore_last_repository: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_height: Option<u32>,
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            recent_repositories: Vec::new(),
            external_tools: Vec::new(),
            restore_last_repository: true,
            window_width: None,
            window_height: None,
        }
    }
}

pub fn load(dir: &Path) -> SettingsDto {
    let path = settings_path(dir);
    let Ok(bytes) = std::fs::read(&path) else {
        return SettingsDto::default();
    };
    match serde_json::from_slice::<SettingsDto>(&bytes) {
        Ok(settings) if settings.schema_version == SCHEMA_VERSION => settings,
        Ok(stale) => {
            backup(dir, &path, stale.schema_version);
            SettingsDto::default()
        }
        Err(_) => {
            backup(dir, &path, 0);
            SettingsDto::default()
        }
    }
}

fn backup(dir: &Path, path: &Path, version: u32) {
    let target = dir.join(format!("settings.v{version}.bak"));
    let _ = std::fs::rename(path, target);
}

pub fn save(dir: &Path, settings: &SettingsDto) -> Result<SettingsDto, UserVisibleError> {
    let mut next = settings.clone();
    next.schema_version = SCHEMA_VERSION;
    next.recent_repositories.truncate(MAX_RECENT);
    validate(&next)?;
    std::fs::create_dir_all(dir).map_err(io_error)?;
    let path = settings_path(dir);
    write_atomic(&path, &serde_json::to_vec_pretty(&next).map_err(|e| {
        UserVisibleError::new(ErrorCode::Internal, "设置序列化失败").with_detail(e.to_string())
    })?)
    .map_err(io_error)?;
    Ok(next)
}

fn validate(settings: &SettingsDto) -> Result<(), UserVisibleError> {
    for tool in &settings.external_tools {
        if tool.name.trim().is_empty() || tool.executable.trim().is_empty() {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "外部工具的名称与可执行文件不能为空",
            ));
        }
        if tool.args_template.len() > MAX_TEMPLATE_LEN {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "外部工具参数模板过长",
            ));
        }
        if tool.args_template.contains('\0') || tool.executable.contains('\0') {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "外部工具配置包含非法字符",
            ));
        }
    }
    Ok(())
}

pub fn remember(dir: &Path, current: &SettingsDto, path: &Path) -> Result<SettingsDto, UserVisibleError> {
    let canonical = std::fs::canonicalize(path).map_err(|e| {
        UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不可访问")
            .with_detail(e.to_string())
    })?;
    if !canonical.is_dir() {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "仓库路径必须是目录",
        ));
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
    settings.recent_repositories.truncate(MAX_RECENT);
    save(dir, &settings)
}

fn same_path(a: &str, b: &str) -> bool {
    let normalize = |value: &str| value.replace('\\', "/").to_lowercase();
    normalize(a) == normalize(b)
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

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            // Windows 不允许 rename 覆盖既有文件；删除后重试一次。
            if path.exists() {
                std::fs::remove_file(path)?;
                std::fs::rename(&tmp, path)
            } else {
                Err(err)
            }
        }
    }
}

fn io_error(err: std::io::Error) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Io, "读写应用配置失败").with_detail(err.to_string())
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("创建临时目录失败")
    }

    #[test]
    fn save_then_load_roundtrip_with_schema_version() {
        let dir = temp_dir();
        let mut settings = SettingsDto::default();
        settings.restore_last_repository = false;
        settings.window_width = Some(1200);
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.schema_version, SCHEMA_VERSION);
        let loaded = load(dir.path());
        assert!(!loaded.restore_last_repository);
        assert_eq!(loaded.window_width, Some(1200));
        assert!(settings_path(dir.path()).exists());
    }

    #[test]
    fn save_truncates_recent_repositories_to_limit() {
        let dir = temp_dir();
        let mut settings = SettingsDto::default();
        settings.recent_repositories = (0..MAX_RECENT + 5)
            .map(|i| RecentRepository {
                path: format!("C:/repo/{i}"),
                last_opened_at: i as i64,
            })
            .collect();
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.recent_repositories.len(), MAX_RECENT);
        assert_eq!(saved.recent_repositories[0].path, "C:/repo/0");
    }

    #[test]
    fn corrupt_settings_are_backed_up_and_defaults_returned() {
        let dir = temp_dir();
        std::fs::write(settings_path(dir.path()), b"{ not json").expect("写入损坏设置失败");
        let loaded = load(dir.path());
        assert_eq!(loaded.schema_version, SCHEMA_VERSION);
        assert!(dir.path().join("settings.v0.bak").exists());
    }

    #[test]
    fn stale_schema_is_backed_up() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(dir.path()),
            br#"{"schema_version":99,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
        )
        .expect("写入旧版本设置失败");
        let loaded = load(dir.path());
        assert_eq!(loaded.schema_version, SCHEMA_VERSION);
        assert!(dir.path().join("settings.v99.bak").exists());
    }

    #[test]
    fn remember_dedupes_case_insensitive_paths_and_moves_to_front() {
        let dir = temp_dir();
        let repo = dir.path().join("Repo");
        std::fs::create_dir_all(&repo).expect("创建仓库目录失败");
        let mut settings = SettingsDto::default();
        settings.recent_repositories = vec![
            RecentRepository {
                path: repo.to_string_lossy().to_uppercase(),
                last_opened_at: 1,
            },
            RecentRepository {
                path: "C:/other".to_string(),
                last_opened_at: 2,
            },
        ];
        let saved = remember(dir.path(), &settings, &repo).expect("记录最近仓库失败");
        assert_eq!(saved.recent_repositories.len(), 2);
        let first = saved.recent_repositories[0].path.replace('\\', "/").to_lowercase();
        assert_eq!(first, repo.to_string_lossy().replace('\\', "/").to_lowercase());
    }

    #[test]
    fn invalid_external_tool_is_rejected() {
        let dir = temp_dir();
        let mut settings = SettingsDto::default();
        settings.external_tools.push(ExternalToolConfig {
            name: "  ".to_string(),
            executable: "bc.exe".to_string(),
            args_template: "$LOCAL $REMOTE".to_string(),
        });
        let err = save(dir.path(), &settings).expect_err("应拒绝空名称");
        assert_eq!(err.code, ErrorCode::InvalidArgument);
    }
}
