//! 标签页装配：打开/激活/关闭仓库并静默写回打开列表（ADR-0032 / ADR-0036）。
//!
//! 语义约束：
//! - 标签数不设上限；常驻的文件监听只覆盖活动标签与最近使用的一小批仓库；
//! - 同路径再次打开 = 激活已有标签，不重建 Git 模块；
//! - 启动恢复只为活动标签读取状态，其余仓库在首次切换时才读；
//! - 打开/切换不再回收其他仓库的终端，只有关闭标签才回收；
//! - 所有 Git 工作都在注册表锁外执行。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use git_core::{ErrorCode, RepoStateDto, Result, UserVisibleError};
use git_read::GitReadModule;
use git_write::GitWriteModule;
use refresh::RefreshReason;
use serde::Serialize;
use tauri::AppHandle;

use super::super::logging;
use super::{AppState, RepoEntry, RepoId, Session};

#[derive(Debug, Clone, Serialize)]
pub struct RepoTabDto {
    pub repo_id: RepoId,
    pub path: String,
    /// 标签名取目录名；路径无文件名（如根目录）时回落完整路径。
    pub name: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoListDto {
    pub repos: Vec<RepoTabDto>,
    pub active: Option<RepoId>,
}

/// 启动恢复结果：全部标签一次返回，仅活动仓库带完整状态。
#[derive(Debug, Clone, Serialize)]
pub struct RepoRestoreDto {
    pub list: RepoListDto,
    pub active_state: Option<RepoStateDto>,
    /// 无法恢复的路径（目录不存在、不是 Git 仓库或权限不足）。
    pub failures: Vec<String>,
}

impl AppState {
    /// 打开或激活：路径必须先规范化并确认是目录。
    pub fn open_repository(self: &Arc<Self>, app: &AppHandle, path: &str) -> Result<RepoStateDto> {
        let open_path = resolve_repo_dir(path)?;
        if let Some(entry) = self.registry().find_by_path(&open_path)? {
            logging::info(&format!("切换到已打开仓库：{}", entry.path.display()));
            let dto = self.activate_entry(&entry)?;
            self.sync_watcher_pool(app);
            return Ok(dto);
        }
        let read = GitReadModule::open(&open_path, Some(self.paths.index_cache_dir.clone()))?;
        let write = GitWriteModule::new(&open_path)?;
        let mut state_dto = read.state()?;
        // 写前 Gate 与启动恢复共用同一检测来源，避免只读模块与写模块给出不同中断态。
        state_dto.interruption = write.inspect_interruption()?;
        logging::info(&format!(
            "打开仓库 {}（{}，generation {}）",
            state_dto.path,
            state_dto.object_format.as_str(),
            state_dto.generation
        ));
        let entry = self.registry().insert(open_path, Session { read, write })?;
        self.record_generation_for(entry.id, Some(RefreshReason::Manual), state_dto.generation);
        self.sync_watcher_pool(app);
        self.persist_open_tabs();
        Ok(state_dto)
    }

    /// 启动恢复：一次登记全部标签，只为活动仓库读取状态；监听只覆盖池内仓库。
    /// 记录项的失败不影响其它仓库，按路径返回给前端展示。
    pub fn restore_repositories(
        self: &Arc<Self>,
        app: &AppHandle,
        paths: Vec<String>,
        active: Option<String>,
    ) -> Result<RepoRestoreDto> {
        let mut failures = Vec::new();
        for path in paths {
            if let Err(err) = self.register_deferred(&path) {
                logging::warn(&format!(
                    "恢复仓库标签失败：{path}（{}）",
                    err.key.as_deref().unwrap_or("no-key")
                ));
                failures.push(path);
            }
        }
        let target = active
            .as_deref()
            .and_then(|path| resolve_repo_dir(path).ok())
            .and_then(|path| self.registry().find_by_path(&path).ok().flatten())
            .or_else(|| {
                self.registry()
                    .list()
                    .ok()
                    .and_then(|entries| entries.into_iter().last())
            });
        let active_state = match target {
            Some(entry) => {
                self.registry().set_active(entry.id)?;
                // 单个仓库读取失败不能拖垮整个恢复：标签保留，状态延迟到切换时再读。
                match self.state_for(&entry) {
                    Ok(dto) => {
                        self.record_generation_for(entry.id, None, dto.generation);
                        Some(dto)
                    }
                    Err(err) => {
                        logging::warn(&format!(
                            "读取恢复仓库状态失败：{}（{}）",
                            entry.path.display(),
                            err.key.as_deref().unwrap_or("no-key")
                        ));
                        None
                    }
                }
            }
            None => None,
        };
        self.sync_watcher_pool(app);
        self.persist_open_tabs();
        Ok(RepoRestoreDto {
            list: self.list_repositories()?,
            active_state,
            failures,
        })
    }

    /// 仅登记路径与模块，不读状态、不启动监听；首次切换时由激活路径补齐。
    fn register_deferred(&self, path: &str) -> Result<()> {
        let open_path = resolve_repo_dir(path)?;
        if self.registry().find_by_path(&open_path)?.is_some() {
            return Ok(());
        }
        let read = GitReadModule::open(&open_path, Some(self.paths.index_cache_dir.clone()))?;
        let write = GitWriteModule::new(&open_path)?;
        self.registry().insert(open_path, Session { read, write })?;
        Ok(())
    }

    pub fn list_repositories(&self) -> Result<RepoListDto> {
        let active = self.registry().active_id()?;
        let repos = self
            .registry()
            .list()?
            .iter()
            .map(|entry| RepoTabDto {
                repo_id: entry.id,
                path: entry.path.to_string_lossy().into_owned(),
                name: tab_name(&entry.path),
                is_active: Some(entry.id) == active,
            })
            .collect();
        Ok(RepoListDto { repos, active })
    }

    pub fn activate_repository(
        self: &Arc<Self>,
        app: &AppHandle,
        repo_id: RepoId,
    ) -> Result<RepoStateDto> {
        let entry = self.entry(repo_id)?;
        let dto = self.activate_entry(&entry)?;
        self.sync_watcher_pool(app);
        Ok(dto)
    }

    /// 关闭标签：停监听、回收该仓库的 PTY、移除条目；活动标签关闭后按打开顺序接替。
    pub fn close_repository(
        self: &Arc<Self>,
        app: &AppHandle,
        repo_id: Option<RepoId>,
    ) -> Result<Option<RepoStateDto>> {
        let entry = match self.registry().entry_or_active(repo_id) {
            Ok(entry) => entry,
            // 无参关闭且本来就没有活动仓库：视为已关闭，保持旧前端包装器可用。
            Err(err) if repo_id.is_none() && err.code == ErrorCode::RepositoryNotFound => {
                return Ok(None)
            }
            Err(err) => return Err(err),
        };
        self.stop_watcher_for(&entry);
        self.terminals.close_for_repo(entry.id);
        self.registry().remove(entry.id)?;
        logging::info(&format!(
            "关闭仓库标签 {}（{}）",
            entry.id,
            entry.path.display()
        ));
        self.persist_open_tabs();
        // 接替活动标签可能落在池外，需要补监听并把超额仓库移出池。
        self.sync_watcher_pool(app);
        match self.registry().active_entry()? {
            Some(active) => Ok(Some(self.state_for(&active)?)),
            None => Ok(None),
        }
    }

    /// 设为活动并读取状态；监听池同步由调用方负责（有的入口拿不到 AppHandle）。
    fn activate_entry(&self, entry: &Arc<RepoEntry>) -> Result<RepoStateDto> {
        self.registry().set_active(entry.id)?;
        let dto = self.state_for(entry)?;
        self.record_generation_for(entry.id, None, dto.generation);
        self.persist_open_tabs();
        Ok(dto)
    }

    fn state_for(&self, entry: &RepoEntry) -> Result<RepoStateDto> {
        let mut dto = entry.session.read.state()?;
        dto.interruption = entry.session.write.inspect_interruption()?;
        Ok(dto)
    }

    fn persist_open_tabs(&self) {
        let Ok(entries) = self.registry().list() else {
            return;
        };
        let active = self.registry().active_id().ok().flatten();
        let paths: Vec<String> = entries
            .iter()
            .map(|entry| entry.path.to_string_lossy().into_owned())
            .collect();
        let active_path = active
            .and_then(|id| entries.iter().find(|entry| entry.id == id))
            .map(|entry| entry.path.to_string_lossy().into_owned());
        self.persist_settings(|settings| {
            settings.open_repositories = paths;
            settings.active_repository = active_path;
        });
    }
}

/// 规范化用户路径并确认是目录；打开与启动恢复共用同一校验。
fn resolve_repo_dir(path: &str) -> Result<PathBuf> {
    let canonical = std::fs::canonicalize(PathBuf::from(path)).map_err(|e| {
        UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不存在或不可访问")
            .with_key("errors.repoDirNotFound")
            .with_detail(e.to_string())
    })?;
    if !canonical.is_dir() {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "请选择仓库目录")
                .with_key("errors.repoDirectoryRequired"),
        );
    }
    Ok(PathBuf::from(crate::app::config::strip_verbatim(
        &canonical,
    )))
}

fn tab_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}
