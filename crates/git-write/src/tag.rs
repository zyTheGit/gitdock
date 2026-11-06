//! 本地标签创建与删除（ADR 0008）。
//!
//! 标签只存在本地，不执行任何远程操作；附注消息经单参数 `--message=<文本>`
//! 传递，参数数组不经 shell 的既有规则不变。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

use git_core::{ErrorCode, Result, UserVisibleError};

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

/// 编辑描述：非空值重建带附注消息的标签，空值回退为轻量标签。
/// 目标用 `refs/tags/<name>^{commit}` 表达式，保证附注标签被 peel 到提交。
pub(crate) fn set_description_args(
    name: &str,
    target: &str,
    description: &str,
) -> Result<Vec<String>> {
    let message = description.trim();
    if message.is_empty() {
        return Ok(vec![
            "tag".to_owned(),
            "-f".to_owned(),
            name.to_owned(),
            target.to_owned(),
        ]);
    }
    validate_description(message)?;
    Ok(vec![
        "tag".to_owned(),
        "-f".to_owned(),
        "-a".to_owned(),
        format!("--message={message}"),
        name.to_owned(),
        target.to_owned(),
    ])
}

/// 标签描述写入附注消息：允许换行与制表符，拒绝其余控制字符（含 NUL）。
pub(crate) fn validate_description(message: &str) -> Result<()> {
    if message
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "标签描述不能包含 NUL 等控制字符",
        )
        .with_key("errors.tagDescriptionControlChars"));
    }
    Ok(())
}
