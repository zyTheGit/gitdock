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
    /// 界面语言覆盖；None 时跟随系统语言。合法取值见 `SUPPORTED_LANGUAGES`。
    /// 只能经 `set_language` 命令修改：语言切换即时生效，不走设置草稿的「保存」。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// 终端 Shell 模式的启动器；合法取值见 `SHELL_PROFILES`（default / git_bash）。
    /// 走设置草稿「保存」：已运行会话不受影响，下次启动 Shell 时生效。
    /// 非 Windows 平台上 git_bash 无意义，读取时回落 default。
    #[serde(default = "default_shell_profile")]
    pub shell_profile: String,
}

/// 支持的语言。首期仅简体中文与英文。
pub const SUPPORTED_LANGUAGES: &[&str] = &["zh-CN", "en"];

/// 终端 Shell 启动器白名单；存储值与前端 Select 的 value 一致。
pub const SHELL_PROFILES: &[&str] = &["default", "git_bash"];

fn default_shell_profile() -> String {
    "default".to_owned()
}

fn shell_profile_valid(value: &str) -> bool {
    SHELL_PROFILES.contains(&value)
}

fn language_valid(value: &Option<String>) -> bool {
    value
        .as_deref()
        .is_none_or(|lang| SUPPORTED_LANGUAGES.contains(&lang))
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
            language: None,
            shell_profile: default_shell_profile(),
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
            // 手改配置可能写入不支持的语言；读取时回落到跟随系统。
            if !language_valid(&settings.language) {
                settings.language = None;
            }
            // 手改配置可能写入非法 Shell 启动器；读取时回落系统默认。
            if !shell_profile_valid(&settings.shell_profile) {
                settings.shell_profile = default_shell_profile();
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
        )
        .with_key("errors.settingFontScaleOutOfRange"));
    }
    if !language_valid(&next.language) {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "不支持的语言")
                .with_key("errors.settingLanguageUnsupported"),
        );
    }
    if !shell_profile_valid(&next.shell_profile) {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "不支持的终端 Shell 启动器")
                .with_key("errors.settingShellProfileUnsupported"),
        );
    }
    validate(&next)?;
    std::fs::create_dir_all(dir).map_err(io_error)?;
    let path = settings_path(dir);
    write_atomic(
        &path,
        &serde_json::to_vec_pretty(&next).map_err(|e| {
            UserVisibleError::new(ErrorCode::Internal, "设置序列化失败")
                .with_key("errors.settingSerializeFailed")
                .with_detail(e.to_string())
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
    UserVisibleError::new(ErrorCode::Io, "读写应用配置失败")
        .with_key("errors.settingReadWriteFailed")
        .with_detail(err.to_string())
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

#[cfg(test)]
mod tests;
