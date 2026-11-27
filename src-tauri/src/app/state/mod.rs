//! 应用装配状态：多仓库注册表、配置存储与路径。
//! 模块边界：只有 command 层接触本状态，Git 细节留在 git-read。
//!
//! ADR-0032：单会话升级为同窗口多仓库标签页——注册表与代际协调器按仓库隔离，
//! 读写 command 仍缺省作用于活动仓库，前端单仓数据流不变。

mod registry;
mod tabs;

pub use registry::{RepoEntry, RepoId, RepoRegistry};
pub use tabs::{RepoListDto, RepoRestoreDto};

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use git_core::{ErrorCode, Result, UserVisibleError};
use git_read::GitReadModule;
use git_write::GitWriteModule;
use refresh::RefreshReason;
use tauri::{AppHandle, Manager};

use super::config::{self, SettingsDto};
use super::external;
use super::gitlog;
use super::logging;
use super::terminal::TerminalRegistry;
use super::watch;

pub struct Session {
    pub read: GitReadModule,
    pub write: GitWriteModule,
}

/// 文件监听池容量：标签数不设上限，但只为活动标签与最近切换过的仓库保留监听（ADR-0036）。
pub(crate) const WATCH_POOL_LIMIT: usize = 8;

pub struct AppPaths {
    pub config_dir: PathBuf,
    pub log_path: PathBuf,
    pub index_cache_dir: PathBuf,
    pub external_tmp_dir: PathBuf,
}

pub struct AppState {
    registry: RepoRegistry,
    settings: Mutex<SettingsDto>,
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
        // 实时刷新事件发射器：日志标签激活期间前端订阅 gitlog://changed 重拉快照。
        gitlog::set_emitter(handle.clone());
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
            registry: RepoRegistry::new(),
            settings: Mutex::new(settings),
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

    /// 静默写回设置：标签页打开/切换/关闭后持久化，不经过设置弹窗草稿。
    /// 写盘失败只记日志，不回滚已经生效的内存状态。
    pub(crate) fn persist_settings(&self, mutate: impl FnOnce(&mut SettingsDto)) {
        let Ok(mut next) = self.settings() else {
            return;
        };
        mutate(&mut next);
        match config::save(&self.paths.config_dir, &next) {
            Ok(saved) => {
                if let Ok(mut guard) = self.settings.lock() {
                    *guard = saved;
                }
            }
            Err(err) => logging::warn(&format!("保存打开仓库列表失败：{err}")),
        }
    }

    /// 语言覆盖独立保存：语言切换即时生效，不经过设置弹窗的整体「保存」。
    pub fn set_language(&self, language: Option<String>) -> Result<SettingsDto> {
        let mut next = self.settings()?;
        next.language = language;
        self.save_settings(next)
    }

    /// Shell 启动器独立保存：面板内切换即时生效，不经过设置弹窗的整体「保存」。
    pub fn set_shell_profile(&self, profile: String) -> Result<SettingsDto> {
        let mut next = self.settings()?;
        next.shell_profile = profile;
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

    pub(crate) fn registry(&self) -> &RepoRegistry {
        &self.registry
    }

    /// 活动仓库条目；没有活动标签时报 `errors.repoNotOpen`。
    pub fn active_entry(&self) -> Result<Arc<RepoEntry>> {
        self.registry.active_entry()?.ok_or_else(no_repository)
    }

    pub fn entry(&self, repo_id: RepoId) -> Result<Arc<RepoEntry>> {
        self.registry.entry(repo_id)
    }

    /// 按 `repo_id`（None = 活动仓库）返回条目；无活动标签时报 `errors.repoNotOpen`。
    pub fn entry_or_active(&self, repo_id: Option<RepoId>) -> Result<Arc<RepoEntry>> {
        self.registry.entry_or_active(repo_id)
    }

    /// 按 `repo_id`（None = 活动仓库）取出条目；闭包在注册表锁之外执行，
    /// 打开/关闭带来的写锁不会被长时间的 Git 读取阻塞。
    pub fn with_entry<T>(
        &self,
        repo_id: Option<RepoId>,
        f: impl FnOnce(&RepoEntry) -> Result<T>,
    ) -> Result<T> {
        let entry = self.entry_or_active(repo_id)?;
        f(&entry)
    }

    /// 既有读/写 command 的唯一入口：作用于活动仓库。
    pub fn with_session<T>(&self, f: impl FnOnce(&Session) -> Result<T>) -> Result<T> {
        let entry = self.active_entry()?;
        f(&entry.session)
    }

    fn request_refresh_for(&self, repo_id: RepoId, reason: RefreshReason) -> u64 {
        match self.registry.find(repo_id) {
            Ok(Some(entry)) => entry
                .refresh
                .lock()
                .map(|mut coordinator| coordinator.request(reason))
                .unwrap_or(0),
            _ => 0,
        }
    }

    fn observe_generation_for(&self, repo_id: RepoId, generation: u64) -> bool {
        match self.registry.find(repo_id) {
            Ok(Some(entry)) => entry
                .refresh
                .lock()
                .map(|mut coordinator| coordinator.observe(generation))
                .unwrap_or(false),
            _ => false,
        }
    }

    fn accept_generation_for(&self, repo_id: RepoId, generation: u64) -> bool {
        match self.registry.find(repo_id) {
            Ok(Some(entry)) => entry
                .refresh
                .lock()
                .map(|mut coordinator| coordinator.accept(generation))
                .unwrap_or(false),
            _ => false,
        }
    }

    /// 统一登记指定仓库的代际变化：可选发起一轮 RefreshRequest、观测代际是否变化并立即确认已接受。
    pub fn record_generation_for(
        &self,
        repo_id: RepoId,
        reason: Option<RefreshReason>,
        generation: u64,
    ) -> bool {
        if let Some(reason) = reason {
            self.request_refresh_for(repo_id, reason);
        }
        let changed = self.observe_generation_for(repo_id, generation);
        self.accept_generation_for(repo_id, generation);
        changed
    }

    /// 为单个仓库启动监听；旧监听先被释放。设置里关闭监听时只停不启。
    pub fn start_watcher_for(self: &Arc<Self>, app: &AppHandle, entry: &Arc<RepoEntry>) {
        let enabled = self.settings().map(|s| s.watch_enabled).unwrap_or(false);
        let Ok(mut guard) = entry.watcher.lock() else {
            logging::warn("文件监听锁不可用，跳过本次启动");
            return;
        };
        *guard = None;
        if !enabled {
            logging::info("文件监听已在设置中关闭");
            return;
        }
        // 目录来自已打开的只读模块（gix 解析结果），不再额外启动 `git rev-parse`。
        let read = &entry.session.read;
        let mut dirs = vec![read.git_dir().to_path_buf()];
        if read.common_dir() != read.git_dir() {
            dirs.push(read.common_dir().to_path_buf());
        }
        match watch::start(
            Arc::downgrade(self),
            app.clone(),
            entry.id,
            entry.path.clone(),
            dirs,
        ) {
            Ok(watcher) => {
                *guard = Some(watcher);
                logging::info(&format!("已启动文件监听：{}", entry.path.display()));
            }
            Err(err) => logging::warn(&err),
        }
    }

    pub fn stop_watcher_for(&self, entry: &RepoEntry) {
        if let Ok(mut guard) = entry.watcher.lock() {
            if guard.take().is_some() {
                logging::info(&format!("已停止文件监听：{}", entry.path.display()));
            }
        }
    }

    /// 池内按需启动：已在监听就保持原线程，避免每次切标签都重建监听。
    fn ensure_watcher_for(self: &Arc<Self>, app: &AppHandle, entry: &Arc<RepoEntry>) {
        let running = entry
            .watcher
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        if !running {
            self.start_watcher_for(app, entry);
        }
    }

    /// 监听池：只保留最近激活的 `WATCH_POOL_LIMIT` 个仓库的监听，其余停止。
    /// 正确性不依赖常驻监听：激活标签时总会先读一次状态并比较代际。
    pub fn sync_watcher_pool(self: &Arc<Self>, app: &AppHandle) {
        let Ok(entries) = self.registry.by_recent_activity() else {
            logging::warn("读取仓库列表失败，跳过监听池同步");
            return;
        };
        let enabled = self.settings().map(|s| s.watch_enabled).unwrap_or(false);
        for (index, entry) in entries.iter().enumerate() {
            if enabled && index < WATCH_POOL_LIMIT {
                self.ensure_watcher_for(app, entry);
            } else {
                self.stop_watcher_for(entry);
            }
        }
    }

    /// 监听开关变更后按新设置重建监听池。
    pub fn restart_watchers(self: &Arc<Self>, app: &AppHandle) {
        let Ok(entries) = self.registry.list() else {
            logging::warn("读取仓库列表失败，跳过监听重启");
            return;
        };
        for entry in &entries {
            self.stop_watcher_for(entry);
        }
        self.sync_watcher_pool(app);
    }
}

pub fn no_repository() -> UserVisibleError {
    UserVisibleError::new(ErrorCode::RepositoryNotFound, "尚未打开仓库")
        .with_key("errors.repoNotOpen")
}

pub(crate) fn internal(message: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, message).with_detail(err.to_string())
}

/// 启动期应用数据目录错误：用户会在启动失败弹窗中看到，按 `Io` 归类并标注 i18n key。
fn io(message: &str, key: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Io, message)
        .with_key(key)
        .with_detail(err.to_string())
}

#[cfg(test)]
mod tests;
