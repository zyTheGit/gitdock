//! GitWriteModule：有限写操作的状态机实现。
//!
//! 约束：只接受白名单操作；一切命令以参数数组启动、不经 shell；每次执行前运行
//! Gate；状态路径全部经 `git rev-parse` 解析取得；绝不自动 abort / quit。
//! 结果以退出码与执行后重新探测到的操作态判定，不解析输出文本猜测冲突。

mod branch;
mod command;
mod commit;
pub mod config;
mod description;
mod execute;
mod gate;
mod remote;
mod staging;
mod stash;
mod status;
mod tag;

use std::path::{Path, PathBuf};

use git_core::{ErrorCode, Result, UserVisibleError};
use parking_lot::Mutex;

pub struct GitWriteModule {
    root: PathBuf,
    /// 全局互斥：同一仓库同一时刻最多一个写操作。
    write_lock: Mutex<()>,
}

impl GitWriteModule {
    pub fn new(root: &Path) -> Result<Self> {
        let root = std::fs::canonicalize(root).map_err(|e| {
            UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不存在或不可访问")
                .with_key("errors.writeIoRepoRootUnavailable")
                .with_detail(e.to_string())
        })?;
        Ok(Self {
            root,
            write_lock: Mutex::new(()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}
