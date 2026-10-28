//! 应用装配状态：单窗口单仓库会话、配置存储与路径。
//! 模块边界：只有 command 层接触本状态，Git 细节留在 git-read。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};

use git_core::{ErrorCode, Result, UserVisibleError};
use git_read::GitReadModule;
use tauri::Manager;

use super::config::{self, SettingsDto};
use super::logging;

pub struct Session {
    pub read: GitReadModule,
}

pub struct AppPaths {
    pub config_dir: PathBuf,
    pub log_path: PathBuf,
    pub index_cache_dir: PathBuf,
    pub external_tmp_dir: PathBuf,
}

pub struct AppState {
    session: RwLock<Option<Session>>,
    settings: Mutex<SettingsDto>,
    pub paths: AppPaths,
}

impl AppState {
    pub fn new(handle: &tauri::AppHandle) -> Result<Self> {
        let config_dir = handle
            .path()
            .app_config_dir()
            .map_err(|e| internal("无法定位配置目录", e))?;
        let log_dir = handle
            .path()
            .app_log_dir()
            .map_err(|e| internal("无法定位日志目录", e))?;
        let cache_dir = handle
            .path()
            .app_cache_dir()
            .map_err(|e| internal("无法定位缓存目录", e))?;
        std::fs::create_dir_all(&config_dir).map_err(|e| internal("创建配置目录失败", e))?;
        let log_path = log_dir.join("git-graph.log");
        logging::init(&log_path);
        logging::info(&format!(
            "启动 Git Graph {}（{}）",
            env!("CARGO_PKG_VERSION"),
            config_dir.display()
        ));
        let settings = config::load(&config_dir);
        Ok(Self {
            session: RwLock::new(None),
            settings: Mutex::new(settings),
            paths: AppPaths {
                config_dir,
                log_path,
                index_cache_dir: cache_dir.join("graph-index"),
                external_tmp_dir: cache_dir.join("external-diff"),
            },
        })
    }

    pub fn settings(&self) -> Result<SettingsDto> {
        self.settings
            .lock()
            .map(|guard| guard.clone())
            .map_err(|_| internal("读取设置锁失败", "settings mutex poisoned"))
    }

    pub fn save_settings(&self, next: SettingsDto) -> Result<SettingsDto> {
        let saved = config::save(&self.paths.config_dir, &next)?;
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| internal("写入设置锁失败", "settings mutex poisoned"))?;
        *guard = saved.clone();
        Ok(saved)
    }

    pub fn remember_repository(&self, path: &Path) -> Result<SettingsDto> {
        let current = self.settings()?;
        let saved = config::remember(&self.paths.config_dir, &current, path)?;
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| internal("写入设置锁失败", "settings mutex poisoned"))?;
        *guard = saved.clone();
        Ok(saved)
    }

    pub fn save_window_size(&self, width: u32, height: u32) {
        let Ok(current) = self.settings() else {
            return;
        };
        let mut next = current;
        next.window_width = Some(width);
        next.window_height = Some(height);
        if let Err(err) = config::save(&self.paths.config_dir, &next) {
            logging::warn(&format!("保存窗口尺寸失败：{err}"));
            return;
        }
        if let Ok(mut guard) = self.settings.lock() {
            *guard = next;
        }
    }

    pub fn with_session<T>(&self, f: impl FnOnce(&Session) -> Result<T>) -> Result<T> {
        let guard = self
            .session
            .read()
            .map_err(|_| internal("仓库会话锁失败", "session rwlock poisoned"))?;
        let session = guard.as_ref().ok_or_else(no_repository)?;
        f(session)
    }

    pub fn replace_session(&self, next: Option<Session>) -> Result<()> {
        let mut guard = self
            .session
            .write()
            .map_err(|_| internal("仓库会话锁失败", "session rwlock poisoned"))?;
        *guard = next;
        Ok(())
    }

    pub fn close(&self) -> Result<()> {
        self.replace_session(None)
    }
}

pub fn no_repository() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::RepositoryNotFound, "尚未打开仓库")
}

fn internal(message: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, message).with_detail(err.to_string())
}
