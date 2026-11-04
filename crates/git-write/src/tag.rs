//! 本地标签创建与删除（ADR 0008）。
//!
//! 标签只存在本地，不执行任何远程操作；附注消息经单参数 `--message=<文本>`
//! 传递，参数数组不经 shell 的既有规则不变。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// 轻量标签：`git tag <name> <target>`。
pub(crate) fn lightweight_args(name: &str, target: &str) -> Vec<String> {
    vec!["tag".to_owned(), name.to_owned(), target.to_owned()]
}

/// 附注标签：`git tag -a --message=<文本> <name> <target>`。
pub(crate) fn annotated_args(name: &str, message: &str, target: &str) -> Vec<String> {
    vec![
        "tag".to_owned(),
        "-a".to_owned(),
        format!("--message={message}"),
        name.to_owned(),
        target.to_owned(),
    ]
}

/// `git tag -d <name>`：仅删除本地标签。
pub(crate) fn delete_args(name: &str) -> Vec<String> {
    vec!["tag".to_owned(), "-d".to_owned(), name.to_owned()]
}
