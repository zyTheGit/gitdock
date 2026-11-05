//! 本地历史整合操作（ADR 0011）：merge 与 rebase。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git merge --no-edit <branch>`：允许非快进合并，但不在应用内启动编辑器。
pub(crate) fn merge_args(branch: &str) -> Vec<String> {
    vec![
        "merge".to_owned(),
        "--no-edit".to_owned(),
        branch.to_owned(),
    ]
}

/// `git rebase <branch>`：非交互 rebase；编辑器由执行器统一禁用。
pub(crate) fn rebase_args(branch: &str) -> Vec<String> {
    vec!["rebase".to_owned(), branch.to_owned()]
}
