//! 本地 stash 读取：`refs/stash` 的 reflog 即 stash 列表（ADR 0009 §2.3）。

use git_core::{Result, StashEntryDto};

use super::{gix_error, GitReadModule};
use crate::util::{lossy, oid_from_gix};

impl GitReadModule {
    /// 本地 stash 快照：index 0 为最新；无 stash 时返回空列表。
    pub fn read_stashes(&self) -> Result<Vec<StashEntryDto>> {
        let repo = self.repo()?;
        let Ok(reference) = repo.find_reference("refs/stash") else {
            return Ok(Vec::new());
        };
        if !reference.log_exists().map_err(gix_error)? {
            return Ok(Vec::new());
        }
        let mut platform = reference.log_iter();
        let Some(lines) = platform.rev().map_err(gix_error)? else {
            return Ok(Vec::new());
        };
        let mut entries = Vec::new();
        for (index, line) in lines.enumerate() {
            let line = line.map_err(gix_error)?;
            entries.push(StashEntryDto {
                index: index as u32,
                selector: format!("stash@{{{index}}}"),
                oid: oid_from_gix(&line.new_oid),
                message: lossy(&line.message),
                created_at: line.signature.time.seconds,
            });
        }
        Ok(entries)
    }
}
