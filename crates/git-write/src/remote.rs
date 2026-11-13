//! 远程基础操作（ADR 0010）：fetch / pull --ff-only / push。
//!
//! 不提供 force push、prune、tags 推送或多 remote 选择；凭据完全交给
//! 系统凭据管理器与 SSH agent。

use git_core::PullMode;

pub(crate) mod failure;

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git fetch`：跟随当前分支上游 remote，无上游时使用 Git 默认 remote。
pub(crate) fn fetch_args() -> Vec<String> {
    vec!["fetch".to_owned()]
}

/// pull 按模式构造：首版默认只快进，merge/rebase 作为显式选择。
pub(crate) fn pull_args(mode: PullMode) -> Vec<String> {
    match mode {
        PullMode::FfOnly => vec!["pull".to_owned(), "--ff-only".to_owned()],
        PullMode::Merge => vec![
            "pull".to_owned(),
            "--no-rebase".to_owned(),
            "--no-edit".to_owned(),
        ],
        PullMode::Rebase => vec!["pull".to_owned(), "--rebase".to_owned()],
    }
}

/// `git push`：使用当前分支上游；不推 tags、不 `--all`、不 `--force`。
pub(crate) fn push_args() -> Vec<String> {
    vec!["push".to_owned()]
}

/// 删除远程分支（ADR 0022）：显式 `<branch>` 由调用方保证非选项注入形态。
pub(crate) fn delete_remote_branch_args(branch: &str) -> Vec<String> {
    vec![
        "push".to_owned(),
        "origin".to_owned(),
        "--delete".to_owned(),
        branch.to_owned(),
    ]
}

/// 删除远程标签（ADR 0022 标签章节）：`push origin --delete <tag>`。
///
/// 使用裸标签名与 Git 交互一致：远端标签不存在时 Git 报 `remote ref does not exist`，
/// 由执行层按成功收尾；同名分支与标签并存时 Git 拒绝（不会误删分支）。
pub(crate) fn delete_remote_tag_args(tag: &str) -> Vec<String> {
    vec![
        "push".to_owned(),
        "origin".to_owned(),
        "--delete".to_owned(),
        tag.to_owned(),
    ]
}
