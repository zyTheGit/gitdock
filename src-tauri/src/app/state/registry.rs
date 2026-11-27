//! 仓库注册表：多仓库标签页的打开、激活与关闭（ADR-0032 / ADR-0036）。
//!
//! 标签数不设上限；常驻资源（文件监听）由活动度决定，注册表只记录最近激活顺序。
//!
//! 只做内存记账，不访问文件系统、不执行 Git；模块构建与监听装配留在
//! `state::tabs` 与 `state` 本体。所有方法取到 `Arc<RepoEntry>` 后立即释放
//! 注册表锁，长耗时的 Git 工作不会阻塞打开/关闭路径。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

pub use git_core::RepoId;
use git_core::{ErrorCode, Result, UserVisibleError};
use refresh::RefreshCoordinator;

use super::super::platform::same_path;
use super::super::watch::RepositoryWatcher;
use super::{internal, no_repository, Session};

pub struct RepoEntry {
    pub id: RepoId,
    /// 规范化（并剥离 Windows verbatim 前缀）后的仓库路径。
    pub path: PathBuf,
    pub session: Session,
    /// 每仓独立的代际协调器：一个仓库的过期结果不能覆盖另一个仓库的 UI。
    pub refresh: Mutex<RefreshCoordinator>,
    pub watcher: Mutex<Option<RepositoryWatcher>>,
    /// 打开顺序；关闭活动标签后按此选择最近打开的接替者。
    pub opened_at: u64,
    /// 最近一次成为活动标签的顺序号；监听池按此保留最近使用的仓库。
    pub last_active: AtomicU64,
}

#[derive(Default)]
pub struct RepoRegistry {
    repos: RwLock<HashMap<RepoId, Arc<RepoEntry>>>,
    active: RwLock<Option<RepoId>>,
    next_repo_id: AtomicU64,
    open_counter: AtomicU64,
    activation_counter: AtomicU64,
}

impl RepoRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn find_by_path(&self, path: &Path) -> Result<Option<Arc<RepoEntry>>> {
        let text = path.to_string_lossy();
        let repos = self
            .repos
            .read()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        Ok(repos
            .values()
            .find(|entry| same_path(&entry.path.to_string_lossy(), &text))
            .cloned())
    }

    pub fn find(&self, id: RepoId) -> Result<Option<Arc<RepoEntry>>> {
        let repos = self
            .repos
            .read()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        Ok(repos.get(&id).cloned())
    }

    pub fn entry(&self, id: RepoId) -> Result<Arc<RepoEntry>> {
        self.find(id)?.ok_or_else(|| not_found(id))
    }

    pub fn active_id(&self) -> Result<Option<RepoId>> {
        let active = self
            .active
            .read()
            .map_err(|_| internal("活动仓库锁失败", "active rwlock poisoned"))?;
        Ok(*active)
    }

    pub fn active_entry(&self) -> Result<Option<Arc<RepoEntry>>> {
        match self.active_id()? {
            Some(id) => self.find(id),
            None => Ok(None),
        }
    }

    /// 按显式 id 或活动仓库取条目；两者都不存在时报未打开/不存在。
    pub fn entry_or_active(&self, id: Option<RepoId>) -> Result<Arc<RepoEntry>> {
        match id {
            Some(id) => self.entry(id),
            None => self.active_entry()?.ok_or_else(no_repository),
        }
    }

    pub fn set_active(&self, id: RepoId) -> Result<()> {
        // 先确认仓库存在，避免持久化出悬空的活动 id。
        let entry = self.entry(id)?;
        let stamp = self.activation_counter.fetch_add(1, Ordering::Relaxed) + 1;
        entry.last_active.store(stamp, Ordering::Relaxed);
        let mut active = self
            .active
            .write()
            .map_err(|_| internal("活动仓库锁失败", "active rwlock poisoned"))?;
        *active = Some(id);
        Ok(())
    }

    /// 登记新仓库并设为活动。同路径已存在时复用原条目（不重建模块）并激活。
    pub fn insert(&self, path: PathBuf, session: Session) -> Result<Arc<RepoEntry>> {
        let mut repos = self
            .repos
            .write()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        let text = path.to_string_lossy();
        if let Some(existing) = repos
            .values()
            .find(|entry| same_path(&entry.path.to_string_lossy(), &text))
            .cloned()
        {
            drop(repos);
            self.set_active(existing.id)?;
            return Ok(existing);
        }
        let id = self.next_repo_id.fetch_add(1, Ordering::Relaxed) + 1;
        let entry = Arc::new(RepoEntry {
            id,
            path,
            session,
            refresh: Mutex::new(RefreshCoordinator::new()),
            watcher: Mutex::new(None),
            opened_at: self.open_counter.fetch_add(1, Ordering::Relaxed) + 1,
            last_active: AtomicU64::new(0),
        });
        repos.insert(id, Arc::clone(&entry));
        drop(repos);
        self.set_active(id)?;
        Ok(entry)
    }

    /// 移除标签；若关闭的是活动标签，接替者为剩余标签中最近打开的一个。
    pub fn remove(&self, id: RepoId) -> Result<Arc<RepoEntry>> {
        let mut repos = self
            .repos
            .write()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        let Some(entry) = repos.remove(&id) else {
            return Err(not_found(id));
        };
        let mut active = self
            .active
            .write()
            .map_err(|_| internal("活动仓库锁失败", "active rwlock poisoned"))?;
        if *active == Some(id) {
            let successor = repos.values().max_by_key(|entry| entry.opened_at).cloned();
            if let Some(entry) = &successor {
                // 接替者虽按打开顺序选出，但语义上刚刚成为活动标签：
                // 刷新活动度，保证监听池一定保留它。
                let stamp = self.activation_counter.fetch_add(1, Ordering::Relaxed) + 1;
                entry.last_active.store(stamp, Ordering::Relaxed);
            }
            *active = successor.map(|entry| entry.id);
        }
        Ok(entry)
    }

    /// 按打开顺序返回全部标签（最早的在前）。
    pub fn list(&self) -> Result<Vec<Arc<RepoEntry>>> {
        let repos = self
            .repos
            .read()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        let mut entries: Vec<Arc<RepoEntry>> = repos.values().cloned().collect();
        drop(repos);
        entries.sort_by_key(|entry| entry.opened_at);
        Ok(entries)
    }

    /// 按最近激活顺序（最新的在前）返回全部条目，供监听池选择保留对象。
    pub fn by_recent_activity(&self) -> Result<Vec<Arc<RepoEntry>>> {
        let repos = self
            .repos
            .read()
            .map_err(|_| internal("仓库注册表锁失败", "repos rwlock poisoned"))?;
        let mut entries: Vec<Arc<RepoEntry>> = repos.values().cloned().collect();
        drop(repos);
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.last_active.load(Ordering::Relaxed)));
        Ok(entries)
    }
}

fn not_found(id: RepoId) -> UserVisibleError {
    UserVisibleError::new(
        ErrorCode::RepositoryNotFound,
        format!("仓库标签 {id} 不存在"),
    )
    .with_key("errors.repositoryNotFound")
    .with_arg("repoId", id.to_string())
}
