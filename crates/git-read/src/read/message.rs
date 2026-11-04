//! HEAD 提交消息读取：amend 预填当前消息（ADR 0007 §2.3）。

use git_core::Result;

use super::{gix_error, read_head, GitReadModule};
use crate::util::{find_commit, lossy};

impl GitReadModule {
    /// HEAD 提交的完整消息（`git log -1 --pretty=%B` 等价形态）。
    /// unborn HEAD（含空仓库）返回 None；读路径归 git-read，不触碰写状态。
    pub fn read_head_message(&self) -> Result<Option<String>> {
        let repo = self.repo()?;
        let Some(oid) = read_head(&repo)?.oid else {
            return Ok(None);
        };
        let commit = find_commit(&repo, &oid)?;
        let message = lossy(commit.message_raw().map_err(gix_error)?.as_ref());
        Ok(Some(message))
    }
}
