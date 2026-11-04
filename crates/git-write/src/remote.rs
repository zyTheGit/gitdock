//! 远程基础操作（ADR 0010）：fetch / pull --ff-only / push。
//!
//! 不提供 force push、prune、tags 推送或多 remote 选择；凭据完全交给
//! 系统凭据管理器与 SSH agent。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git fetch`：跟随当前分支上游 remote，无上游时使用 Git 默认 remote。
pub(crate) fn fetch_args() -> Vec<String> {
    vec!["fetch".to_owned()]
}

/// `git pull --ff-only`：只允许快进，不产生 merge commit。
pub(crate) fn pull_args() -> Vec<String> {
    vec!["pull".to_owned(), "--ff-only".to_owned()]
}

/// `git push`：使用当前分支上游；不推 tags、不 `--all`、不 `--force`。
pub(crate) fn push_args() -> Vec<String> {
    vec!["push".to_owned()]
}
