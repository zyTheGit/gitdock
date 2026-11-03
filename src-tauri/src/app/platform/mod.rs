//! 平台适配层：OS 差异行为收敛点（ADR-0005）。
//!
//! 业务文件（terminal/external/config）不写 `cfg` 平台分支，一律调用本模块。
//! 分派方式为编译期 cfg 纯函数：每个能力都有三平台真实变体，但无运行时
//! 替换需求，不做 trait 注入。探测类函数延续安全约定：只检查已知路径、
//! PATH 只取绝对条目、绝不启动进程。

mod paths;
mod shell;
mod tools;
mod url;

pub(crate) use paths::{absolute_path_entries, same_path};
#[cfg(windows)]
pub(crate) use shell::detect_git_bash;
pub(crate) use shell::{resolve_shell, ShellProfile};
pub(crate) use tools::detect_tools;
pub(crate) use url::open_url;
