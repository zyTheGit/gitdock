//! 跨层契约 DTO。
//!
//! 按领域拆分为子模块，并在此统一下重导出，对外路径保持不变：
//! `git_core::Foo`（经 `lib.rs` 的 `pub use dto::*`）与 `git_core::dto::Foo` 均可用。

mod compare;
mod diff;
mod graph;
mod history;
mod repo;
mod stash;
mod worktree;
mod write;

pub use compare::*;
pub use diff::*;
pub use graph::*;
pub use history::*;
pub use repo::*;
pub use stash::*;
pub use worktree::*;
pub use write::*;
