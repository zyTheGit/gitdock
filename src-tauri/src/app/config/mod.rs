//! 应用配置：平台配置目录下的 settings.json（含 schema version）。
//! 仅本模块与 Tauri command 层接触该文件；前端只拿到结构化 DTO。

mod recent;
mod tools;

use std::path::{Path, PathBuf};

use git_core::{ErrorCode, UserVisibleError};
use serde::{Deserialize, Serialize};

pub(crate) use recent::strip_verbatim;
pub use recent::{forget, remember, RecentRepository};
pub use tools::ExternalToolConfig;
use tools::{detected_tools, normalize_default_tool, seed_tools, validate};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsDto {
    pub schema_version: u32,
    pub recent_repositories: Vec<RecentRepository>,
    pub external_tools: Vec<ExternalToolConfig>,
    pub restore_last_repository: bool,
    /// 文件系统监听开关；旧配置缺省时按开启处理。
    #[serde(default = "default_watch_enabled")]
    pub watch_enabled: bool,
    /// LazyGit 可执行文件路径；留空时从 PATH 查找。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lazygit_path: Option<String>,
    /// 对比视图默认选中的外部工具名称；工具被删除或改名后自动失效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_tool: Option<String>,
    /// 是否已执行过内置工具探测；用户清空工具后不再重复注入。
    #[serde(default)]
    pub tools_seeded: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_height: Option<u32>,
    /// 界面缩放比例；1.0 为 100%。旧配置缺省时按 100% 处理。
    #[serde(default = "default_font_scale")]
    pub font_scale: f64,
}

impl Default for SettingsDto {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            recent_repositories: Vec::new(),
            external_tools: Vec::new(),
            restore_last_repository: true,
            watch_enabled: true,
            lazygit_path: None,
            default_tool: None,
            tools_seeded: false,
            window_width: None,
            window_height: None,
            font_scale: default_font_scale(),
        }
    }
}

fn default_watch_enabled() -> bool {
    true
}

fn default_font_scale() -> f64 {
    1.0
}

pub const MIN_FONT_SCALE: f64 = 0.75;
pub const MAX_FONT_SCALE: f64 = 2.0;

fn font_scale_in_range(value: f64) -> bool {
    (MIN_FONT_SCALE..=MAX_FONT_SCALE).contains(&value)
}

pub fn load(dir: &Path) -> SettingsDto {
    let path = settings_path(dir);
    let Ok(bytes) = std::fs::read(&path) else {
        return seeded_default();
    };
    match serde_json::from_slice::<SettingsDto>(&bytes) {
        Ok(mut settings) if settings.schema_version == SCHEMA_VERSION => {
            // 旧配置没有工具时补一次内置探测；用户清空后 tools_seeded 已为 true，不再注入。
            if !settings.tools_seeded {
                seed_tools(&mut settings, detected_tools());
            }
            // 手改配置可能越界；读取时回落到 100%，避免把界面缩到不可用。
            if !font_scale_in_range(settings.font_scale) {
                settings.font_scale = default_font_scale();
            }
            settings
        }
        Ok(stale) => {
            backup(dir, &path, stale.schema_version);
            seeded_default()
        }
        Err(_) => {
            backup(dir, &path, 0);
            seeded_default()
        }
    }
}

fn seeded_default() -> SettingsDto {
    let mut settings = SettingsDto::default();
    seed_tools(&mut settings, detected_tools());
    settings
}

fn backup(dir: &Path, path: &Path, version: u32) {
    let target = dir.join(format!("settings.v{version}.bak"));
    let _ = std::fs::rename(path, target);
}

pub fn save(dir: &Path, settings: &SettingsDto) -> Result<SettingsDto, UserVisibleError> {
    let mut next = settings.clone();
    next.schema_version = SCHEMA_VERSION;
    // 最近仓库只是路径列表，不扫描磁盘，因此不做条数截断。
    // 一旦落盘，工具列表归用户所有，后续启动不再自动补探测结果。
    next.tools_seeded = true;
    normalize_default_tool(&mut next);
    if !font_scale_in_range(next.font_scale) {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "界面缩放比例需在 75% 与 200% 之间",
        ));
    }
    validate(&next)?;
    std::fs::create_dir_all(dir).map_err(io_error)?;
    let path = settings_path(dir);
    write_atomic(
        &path,
        &serde_json::to_vec_pretty(&next).map_err(|e| {
            UserVisibleError::new(ErrorCode::Internal, "设置序列化失败").with_detail(e.to_string())
        })?,
    )
    .map_err(io_error)?;
    Ok(next)
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
    use super::tools::{detected_tools, seed_tools};
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("创建临时目录失败")
    }

    #[test]
    fn missing_font_scale_defaults_to_one() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(dir.path()),
            br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
        )
        .expect("写入旧版设置失败");
        assert_eq!(load(dir.path()).font_scale, 1.0);
    }

    #[test]
    fn font_scale_roundtrips_when_saved() {
        let dir = temp_dir();
        let settings = SettingsDto {
            font_scale: 1.25,
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.font_scale, 1.25);
        assert_eq!(load(dir.path()).font_scale, 1.25);
    }

    #[test]
    fn out_of_range_font_scale_is_rejected_on_save() {
        let dir = temp_dir();
        for scale in [0.5, 2.5, f64::NAN] {
            let settings = SettingsDto {
                font_scale: scale,
                ..Default::default()
            };
            let err = save(dir.path(), &settings).expect_err("应拒绝越界缩放");
            assert_eq!(err.code, ErrorCode::InvalidArgument);
        }
    }

    #[test]
    fn out_of_range_font_scale_falls_back_to_one_on_load() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(dir.path()),
            br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true,"font_scale":5.0}"#,
        )
        .expect("写入越界设置失败");
        assert_eq!(load(dir.path()).font_scale, 1.0);
    }

    #[test]
    fn save_then_load_roundtrip_with_schema_version() {
        let dir = temp_dir();
        let settings = SettingsDto {
            restore_last_repository: false,
            window_width: Some(1200),
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.schema_version, SCHEMA_VERSION);
        let loaded = load(dir.path());
        assert!(!loaded.restore_last_repository);
        assert_eq!(loaded.window_width, Some(1200));
        assert!(settings_path(dir.path()).exists());
    }

    #[test]
    fn missing_watch_flag_defaults_to_enabled() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(dir.path()),
            br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
        )
        .expect("写入旧版设置失败");
        assert!(load(dir.path()).watch_enabled);
    }

    #[test]
    fn watch_flag_roundtrips_when_disabled() {
        let dir = temp_dir();
        let settings = SettingsDto {
            watch_enabled: false,
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert!(!saved.watch_enabled);
        assert!(!load(dir.path()).watch_enabled);
    }

    #[test]
    fn save_keeps_all_recent_repositories() {
        let dir = temp_dir();
        let settings = SettingsDto {
            recent_repositories: (0..120)
                .map(|i| RecentRepository {
                    path: format!("C:/repo/{i}"),
                    last_opened_at: i as i64,
                })
                .collect(),
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.recent_repositories.len(), 120);
        assert_eq!(saved.recent_repositories[0].path, "C:/repo/0");
        assert_eq!(
            save(dir.path(), &saved)
                .expect("二次保存失败")
                .recent_repositories
                .len(),
            120
        );
        assert_eq!(load(dir.path()).recent_repositories.len(), 120);
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
        // 大小写不同的同一份路径要以规范化结果为基准构造：临时目录本身可能带 8.3 短名
        // （如 CI 上的 C:\Users\RUNNER~1），而 canonicalize 会展开成长名。
        let canonical = strip_verbatim(&std::fs::canonicalize(&repo).expect("规范化路径失败"));
        let settings = SettingsDto {
            recent_repositories: vec![
                RecentRepository {
                    path: canonical.to_uppercase(),
                    last_opened_at: 1,
                },
                RecentRepository {
                    path: "C:/other".to_string(),
                    last_opened_at: 2,
                },
            ],
            ..Default::default()
        };
        let saved = remember(dir.path(), &settings, &repo).expect("记录最近仓库失败");
        assert_eq!(saved.recent_repositories.len(), 2);
        let first = saved.recent_repositories[0]
            .path
            .replace('\\', "/")
            .to_lowercase();
        assert_eq!(first, canonical.replace('\\', "/").to_lowercase());
    }

    #[test]
    fn default_tool_is_cleared_when_tool_missing() {
        let dir = temp_dir();
        let settings = SettingsDto {
            external_tools: vec![ExternalToolConfig {
                name: "code".to_string(),
                executable: "Code.exe".to_string(),
                args_template: "--diff $LOCAL $REMOTE".to_string(),
            }],
            default_tool: Some("removed".to_string()),
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.default_tool, None);
    }

    #[test]
    fn default_tool_survives_when_tool_exists() {
        let dir = temp_dir();
        let settings = SettingsDto {
            external_tools: vec![ExternalToolConfig {
                name: "code".to_string(),
                executable: "Code.exe".to_string(),
                args_template: "--diff $LOCAL $REMOTE".to_string(),
            }],
            default_tool: Some(" code ".to_string()),
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert_eq!(saved.default_tool.as_deref(), Some("code"));
    }

    fn fake_tool(name: &str) -> ExternalToolConfig {
        ExternalToolConfig {
            name: name.to_string(),
            executable: format!("C:/tools/{name}.exe"),
            args_template: "--diff $LOCAL $REMOTE".to_string(),
        }
    }

    #[test]
    fn seed_tools_uses_first_detected_tool_as_default() {
        let mut settings = SettingsDto::default();
        seed_tools(&mut settings, vec![fake_tool("VS Code"), fake_tool("Zed")]);
        assert!(settings.tools_seeded);
        assert_eq!(settings.external_tools.len(), 2);
        assert_eq!(settings.default_tool.as_deref(), Some("VS Code"));
    }

    #[test]
    fn seed_tools_keeps_existing_tools_and_default() {
        let mut settings = SettingsDto {
            external_tools: vec![fake_tool("by")],
            default_tool: Some("by".to_string()),
            ..Default::default()
        };
        seed_tools(&mut settings, vec![fake_tool("VS Code")]);
        assert!(settings.tools_seeded);
        assert_eq!(settings.external_tools.len(), 1);
        assert_eq!(settings.external_tools[0].name, "by");
        assert_eq!(settings.default_tool.as_deref(), Some("by"));
    }

    #[test]
    fn cleared_tools_are_not_reseeded_after_save() {
        let dir = temp_dir();
        let settings = SettingsDto {
            external_tools: Vec::new(),
            default_tool: None,
            ..Default::default()
        };
        let saved = save(dir.path(), &settings).expect("保存设置失败");
        assert!(saved.tools_seeded);
        // 用户主动清空后，后续启动不再注入探测到的内置工具。
        assert!(load(dir.path()).external_tools.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn detected_tools_point_to_existing_files() {
        for tool in detected_tools() {
            assert!(!tool.name.is_empty());
            assert!(!tool.args_template.is_empty());
            assert!(Path::new(&tool.executable).is_file(), "{}", tool.executable);
        }
    }

    #[test]
    fn forget_removes_recent_entry_without_touching_others() {
        let dir = temp_dir();
        let settings = SettingsDto {
            recent_repositories: vec![
                RecentRepository {
                    path: "C:/repo/a".to_string(),
                    last_opened_at: 2,
                },
                RecentRepository {
                    path: "C:/repo/b".to_string(),
                    last_opened_at: 1,
                },
            ],
            ..Default::default()
        };
        let saved = forget(dir.path(), &settings, "c:\\repo\\A").expect("移除最近仓库失败");
        assert_eq!(saved.recent_repositories.len(), 1);
        assert_eq!(saved.recent_repositories[0].path, "C:/repo/b");
        assert_eq!(load(dir.path()).recent_repositories.len(), 1);
    }

    #[test]
    fn invalid_external_tool_is_rejected() {
        let dir = temp_dir();
        let settings = SettingsDto {
            external_tools: vec![ExternalToolConfig {
                name: "  ".to_string(),
                executable: "bc.exe".to_string(),
                args_template: "$LOCAL $REMOTE".to_string(),
            }],
            ..Default::default()
        };
        let err = save(dir.path(), &settings).expect_err("应拒绝空名称");
        assert_eq!(err.code, ErrorCode::InvalidArgument);
    }
}
