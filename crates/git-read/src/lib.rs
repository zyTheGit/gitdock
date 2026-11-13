//! GitReadModule：唯一了解 Git 对象结构的只读模块。
//!
//! 公开接口：`open`、`state`、`read_graph_page`、`read_graph_page_around`、
//! `read_commit`、`branches_containing`、`read_file_diff`、`compare`、`compare_file_diff`、
//! `search`、`cancel_search`。

pub mod diff;
pub mod index;
pub mod read;
pub mod search;
pub mod util;

pub use git_core;
pub use graph_layout;
pub use read::{
    detect_git_version, GitReadModule, TreeExport, TreeSink, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT,
    MINIMUM_GIT_VERSION,
};
