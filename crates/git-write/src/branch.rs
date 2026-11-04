//! 分支创建、删除与重命名（ADR 0008）。
//!
//! 只操作本地 refs，不触工作区；删除仅使用安全形态 `-d`，未合并的分支由 Git
//! 拒绝，强制删除 `-D` 留给终端。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git branch <name> [<start-point>]`：创建但不切换当前分支。
pub(crate) fn create_args(name: &str, start: Option<&str>) -> Vec<String> {
    let mut args = vec!["branch".to_owned(), name.to_owned()];
    if let Some(start) = start {
        args.push(start.to_owned());
    }
    args
}

/// `git branch -d <name>`：仅删除已完全合并到 HEAD 的分支。
pub(crate) fn delete_args(name: &str) -> Vec<String> {
    vec!["branch".to_owned(), "-d".to_owned(), name.to_owned()]
}

/// `git branch -m <old> <new>`：重命名本地分支。
pub(crate) fn rename_args(old: &str, new: &str) -> Vec<String> {
    vec![
        "branch".to_owned(),
        "-m".to_owned(),
        old.to_owned(),
        new.to_owned(),
    ]
}