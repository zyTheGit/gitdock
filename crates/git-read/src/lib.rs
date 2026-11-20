//! GitReadModule：唯一了解 Git 对象结构的只读模块。
//!
//! 公开接口：`open`、`state`、`read_graph_page`、`read_graph_page_around`、
//! `read_commit`、`branches_containing`、`read_file_diff`、`read_file_history`、
//! `read_file_blame`、`compare`、`compare_sides`、`compare_file_diff`、`search`、
//! `cancel_search`、`read_stashes`、`read_stash_detail`、`read_stash_file_diff`、
//! `read_reflog`。

pub mod diff;
pub mod index;
pub mod read;
pub mod search;
pub mod util;

pub use git_core;
pub use graph_layout;
pub use read::{
    detect_git_version, is_worktree_ref, GitReadModule, TreeExport, TreeSink, DEFAULT_PAGE_LIMIT,
    DEFAULT_REFLOG_LIMIT, MAX_PAGE_LIMIT, MAX_REFLOG_LIMIT, MINIMUM_GIT_VERSION, WORKTREE_REF,
};
