//! 应用装配状态：单窗口单仓库会话、配置存储与路径。
//! 模块边界：只有 command 层接触本状态，Git 细节留在 git-read。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use git_core::{ErrorCode, Result, UserVisibleError};
use git_read::GitReadModule;
use git_write::GitWriteModule;
use refresh::{RefreshCoordinator, RefreshReason};
use tauri::{AppHandle, Manager};

use super::config::{self, SettingsDto};
use super::external;
use super::gitlog;
use super::logging;
use super::terminal::TerminalRegistry;
use super::watch::{self, RepositoryWatcher};

pub struct Session {
    pub read: GitReadModule,
    pub write: GitWriteModule,
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
    refresh: Mutex<RefreshCoordinator>,
    watcher: Mutex<Option<RepositoryWatcher>>,
    pub terminals: TerminalRegistry,
    pub paths: AppPaths,
}

impl AppState {
    pub fn new(handle: &tauri::AppHandle) -> Result<Self> {
        let config_dir = handle
            .path()
            .app_config_dir()
            .map_err(|e| io("无法定位配置目录", "errors.appDirConfigLocateFailed", e))?;
        let log_dir = handle
            .path()
            .app_log_dir()
            .map_err(|e| io("无法定位日志目录", "errors.appDirLogLocateFailed", e))?;
        let cache_dir = handle
            .path()
            .app_cache_dir()
            .map_err(|e| io("无法定位缓存目录", "errors.appDirCacheLocateFailed", e))?;
        std::fs::create_dir_all(&config_dir)
            .map_err(|e| io("创建配置目录失败", "errors.appDirConfigCreateFailed", e))?;
        let log_path = log_dir.join("gitdock.log");
        logging::init(&log_path);
        // 命令执行日志的 recorder 依赖应用日志已就绪，紧随其后注入；
        // 全局槽只认首次注入，后续（含测试重复装配）不会重复生效。
        gitlog::init();
        logging::info(&format!(
            "启动 GitDock {}（{}）",
            env!("CARGO_PKG_VERSION"),
            config_dir.display()
        ));
        let settings = config::load(&config_dir);
        let external_tmp_dir = cache_dir.join("external-diff");
        // 启动即清空上次会话残留的外部 diff 临时目录：
        // 既控制缓存体积，也缩短工作副本内容在磁盘上的残留时间。
        external::cleanup_root(&external_tmp_dir);
        Ok(Self {
            session: RwLock::new(None),
            settings: Mutex::new(settings),
            refresh: Mutex::new(RefreshCoordinator::new()),
            watcher: Mutex::new(None),
            terminals: TerminalRegistry::new(),
            paths: AppPaths {
                config_dir,
                log_path,
                index_cache_dir: cache_dir.join("graph-index"),
                external_tmp_dir,
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

    /// 语言覆盖独立保存：语言切换即时生效，不经过设置弹窗的整体「保存」。
    pub fn set_language(&self, language: Option<String>) -> Result<SettingsDto> {
        let mut next = self.settings()?;
        next.language = language;
        self.save_settings(next)
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

    pub fn forget_repository(&self, path: &str) -> Result<SettingsDto> {
        let current = self.settings()?;
        let saved = config::forget(&self.paths.config_dir, &current, path)?;
        let mut guard = self
            .settings
            .lock()
            .map_err(|_| internal("写入设置锁失败", "settings mutex poisoned"))?;
        *guard = saved.clone();
        Ok(saved)
    }

    /// 记录窗口尺寸：最大化时保留上一次的普通尺寸，
    /// 否则下次启动会把“全屏尺寸的普通窗口”当成正常大小恢复。
    pub fn save_window_geometry(&self, width: u32, height: u32, maximized: bool) {
        let Ok(current) = self.settings() else {
            return;
        };
        let mut next = current;
        if !maximized {
            next.window_width = Some(width);
            next.window_height = Some(height);
        }
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

    pub fn request_refresh(&self, reason: RefreshReason) -> u64 {
        self.refresh
            .lock()
            .map(|mut coordinator| coordinator.request(reason))
            .unwrap_or(0)
    }

    pub fn observe_generation(&self, generation: u64) -> bool {
        self.refresh
            .lock()
            .map(|mut coordinator| coordinator.observe(generation))
            .unwrap_or(false)
    }

    /// 记录 UI 已接受的代际；过期结果返回 `false` 且不覆盖当前代际。
    pub fn accept_generation(&self, generation: u64) -> bool {
        self.refresh
            .lock()
            .map(|mut coordinator| coordinator.accept(generation))
            .unwrap_or(false)
    }

    /// 按当前设置启动/停止监听；切换仓库时旧监听先被释放。
    pub fn restart_watcher(self: &Arc<Self>, app: &AppHandle, repo: &Path) {
        let enabled = self.settings().map(|s| s.watch_enabled).unwrap_or(false);
        let Ok(mut guard) = self.watcher.lock() else {
            logging::warn("文件监听锁不可用，跳过本次启动");
            return;
        };
        *guard = None;
        if !enabled {
            logging::info("文件监听已在设置中关闭");
            return;
        }
        match watch::start(Arc::downgrade(self), app.clone(), repo.to_path_buf()) {
            Ok(watcher) => {
                *guard = Some(watcher);
                logging::info(&format!("已启动文件监听：{}", repo.display()));
            }
            Err(err) => logging::warn(&err),
        }
    }

    pub fn stop_watcher(&self) {
        if let Ok(mut guard) = self.watcher.lock() {
            *guard = None;
        }
    }
}

pub fn no_repository() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::RepositoryNotFound, "尚未打开仓库")
        .with_key("errors.repoNotOpen")
}

fn internal(message: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, message).with_detail(err.to_string())
}

/// 启动期应用数据目录错误：用户会在启动失败弹窗中看到，按 `Io` 归类并标注 i18n key。
fn io(message: &str, key: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Io, message)
        .with_key(key)
        .with_detail(err.to_string())
}
