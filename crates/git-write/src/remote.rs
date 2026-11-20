//! 远程操作（ADR 0010、ADR 0022、ADR 0028）：fetch / pull / push、远程删除与同步增强。
//!
//! 不提供 force push、多 remote 管理或凭据输入；凭据完全交给系统凭据管理器与
//! SSH agent。远程选择统一走 [`select_remote`]：显式 `remote` → `origin` →
//! 唯一配置的 remote → 其余情况由 Gate 拒绝并列出可选项。

use git_core::PullMode;

pub(crate) mod failure;

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git fetch`：跟随当前分支上游 remote，无上游时使用 Git 默认 remote。
pub(crate) fn fetch_args() -> Vec<String> {
    vec!["fetch".to_owned()]
}

/// `git fetch --prune`：fetch 并清理远端已删除分支的本地远程跟踪引用（ADR-0028）。
pub(crate) fn fetch_prune_args() -> Vec<String> {
    vec!["fetch".to_owned(), "--prune".to_owned()]
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

/// 把远程跟踪分支检出为跟踪它的本地分支（ADR-0028）。
///
/// 源写完整引用名 `refs/remotes/<remote>/<branch>`：前缀保证参数不可能被当成选项，
/// `--track` 由 Git 据源引用推导 `branch.<local>.remote` / `branch.<local>.merge`。
pub(crate) fn checkout_tracking_args(local: &str, remote_ref: &str) -> Vec<String> {
    vec![
        "switch".to_owned(),
        "-c".to_owned(),
        local.to_owned(),
        "--track".to_owned(),
        remote_ref.to_owned(),
    ]
}

/// 首次推送并建立上游（ADR-0028）：`git push -u <remote> refs/heads/<branch>`。
pub(crate) fn push_set_upstream_args(remote: &str, branch: &str) -> Vec<String> {
    vec![
        "push".to_owned(),
        "-u".to_owned(),
        remote.to_owned(),
        format!("refs/heads/{branch}"),
    ]
}

/// 推送本地标签（ADR-0028）：`git push <remote> refs/tags/<tag>`，不带 `--force`。
pub(crate) fn push_tag_args(remote: &str, tag: &str) -> Vec<String> {
    vec![
        "push".to_owned(),
        remote.to_owned(),
        format!("refs/tags/{tag}"),
    ]
}

/// 远程选择结果；`Ambiguous` 由 Gate 转成带可选列表的 issue。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RemoteChoice {
    Selected(String),
    Missing,
    Ambiguous(Vec<String>),
    /// 显式请求的 remote 不在配置列表中。
    Unknown(String),
}

/// 远程选择策略（ADR-0028）：显式 remote → `origin` → 唯一配置的 remote。
pub(crate) fn select_remote(requested: Option<&str>, available: &[String]) -> RemoteChoice {
    if let Some(requested) = requested.map(str::trim).filter(|name| !name.is_empty()) {
        return if is_safe_name(requested) && available.iter().any(|name| name == requested) {
            RemoteChoice::Selected(requested.to_owned())
        } else {
            RemoteChoice::Unknown(requested.to_owned())
        };
    }
    if available.is_empty() {
        return RemoteChoice::Missing;
    }
    if let Some(origin) = available.iter().find(|name| name.as_str() == "origin") {
        return RemoteChoice::Selected(origin.clone());
    }
    if available.len() == 1 {
        return RemoteChoice::Selected(available[0].clone());
    }
    RemoteChoice::Ambiguous(available.to_vec())
}

/// 检出远程分支时的本地分支名：显式 `new_name` 优先，否则取远程分支去掉 `<remote>/` 前缀。
pub(crate) fn local_branch_name<'a>(remote_branch: &'a str, new_name: Option<&'a str>) -> &'a str {
    if let Some(name) = new_name.map(str::trim).filter(|name| !name.is_empty()) {
        return name;
    }
    remote_branch
        .split_once('/')
        .map(|(_, rest)| rest)
        .unwrap_or(remote_branch)
}

/// remote / 分支 / 标签名共用的防御性检查：非空、不以 `-` 开头、无控制字符。
pub(crate) fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.trim() == name
        && !name.starts_with('-')
        && !name.chars().any(char::is_control)
}
