//! 自研树 diff：基于 gix 读取树与 blob，输出文件列表与单文件 patch。
//!
//! 降级策略：二进制、超过 2MB 的 blob、超过 5000 行的 patch、gitlink 均不生成文本 patch，
//! 而是返回结构化标记，由前端展示。
//!
//! 目录划分：`tree_changes` 负责树遍历与增删统计，`patch` 负责单文件 patch 与原始字节，
//! `unified` 负责统一 diff 文本（含忽略空白模式）。

mod patch;
mod tree_changes;
mod unified;

#[cfg(test)]
mod tests;

// 对外的 crate 内路径保持不变：`crate::diff::<fn>`。
pub(crate) use patch::{diff_content, diff_file, file_bytes, lookup_path};
pub(crate) use tree_changes::{changed_path_matching, collect_changes, MAX_FILES};
