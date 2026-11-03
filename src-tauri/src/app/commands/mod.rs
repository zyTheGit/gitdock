//! 受限 Tauri command seam 的装配层。
//!
//! 约束：前端只能调用这里注册的白名单 command；这里不接受命令字符串、不接受
//! 任意 `.git` 路径，也不向前端暴露 Git 原始对象。只读访问经由 `GitReadModule`，
//! 写操作经由 `GitWriteModule`（内部只调用 Git CLI），二者都按结构化请求工作。
//!
//! command 按域定义在同名子模块，这里统一 re-export：`app::commands::xxx` 的
//! 引用形式与 `lib.rs` `invoke_handler` 的注册单点保持不变。

mod app;
mod read;
mod repo;
mod settings;
mod terminal;
mod write;

pub use self::app::*;
pub use self::read::*;
pub use self::repo::*;
pub use self::settings::*;
pub use self::terminal::*;
pub use self::write::*;

use std::sync::Arc;

use git_core::{Result, UserVisibleError};

use super::state::AppState;

/// command 共用的受管状态句柄。
type Shared = Arc<AppState>;

/// 把阻塞工作移出异步 runtime 线程，command 的异步壳统一经由这里执行。
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| UserVisibleError::internal(format!("后台任务异常：{e}")))?
}
