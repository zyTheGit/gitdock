//! `HEAD` reflog 读取（ADR-0029）：只读恢复视图的数据源。
//!
//! 纯 gix：用 `gix_ref` 的 reflog 反向迭代器按「最新 → 最旧」逐条解码，不启子进程、
//! 不写文件，因此天然满足 `v2_readonly` 静态审计。条目序号与 Git 的 `HEAD@{N}` 一致
//! （0 = 最新）。没有 reflog（新仓库、`core.logAllRefUpdates=false`、纯 bare 操作）时
//! 返回空列表而不是错误——「没有历史可恢复」不是失败。
//!
//! 边界：只读 `HEAD`（不读分支 reflog / `refs/stash`），只读取不回写，不提供
//! expire / gc 之类的清理能力。

use git_core::{ReflogEntryDto, Result};

use super::{gix_error, GitReadModule};
use crate::util::{lossy, oid_from_gix};

/// 默认返回条数：覆盖「刚刚 reset / amend / rebase 之前」的恢复窗口。
pub const DEFAULT_REFLOG_LIMIT: usize = 200;

/// 单次请求上限：防止超大 reflog 整份塞进 IPC 与前端渲染。
pub const MAX_REFLOG_LIMIT: usize = 1000;

impl GitReadModule {
    /// `HEAD` reflog，最新在前，最多 `limit` 条（钳制在 1..=`MAX_REFLOG_LIMIT`）。
    pub fn read_reflog(&self, limit: usize) -> Result<Vec<ReflogEntryDto>> {
        let repo = self.repo()?;
        // unborn / detached HEAD 都能取到 Head；reflog 文件不存在时为 None。
        let head = repo.head().map_err(gix_error)?;
        let limit = limit.clamp(1, MAX_REFLOG_LIMIT);
        let mut platform = head.log_iter();
        let Some(lines) = platform.rev().map_err(gix_error)? else {
            return Ok(Vec::new());
        };

        let mut entries = Vec::new();
        for (index, line) in lines.enumerate() {
            if entries.len() >= limit {
                break;
            }
            let line = line.map_err(gix_error)?;
            let new_oid = &line.new_oid;
            // 空哈希表示「引用被删除」：没有可恢复的目标，`Oid` 也无法表达，跳过。
            // 序号仍按 reflog 真实行号，保证 selector 与 git 自身的 `HEAD@{N}` 一致。
            if new_oid.is_null() {
                continue;
            }
            let previous = &line.previous_oid;
            entries.push(ReflogEntryDto {
                index: index as u32,
                selector: format!("HEAD@{{{index}}}"),
                old_oid: (!previous.is_null()).then(|| oid_from_gix(previous)),
                new_oid: oid_from_gix(new_oid),
                message: lossy(&line.message),
                created_at: line.signature.time.seconds,
            });
        }
        Ok(entries)
    }
}
