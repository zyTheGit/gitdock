//! 手动 stash 的命令构造（ADR 0009）。
//!
//! 只提供 save / apply / pop / drop 四种安全形态；不含 clear / branch / show。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `git stash push [-u] [--message=<文本>]`；空消息不传 `--message`。
pub(crate) fn save_args(message: Option<&str>, include_untracked: bool) -> Vec<String> {
    let mut args = vec!["stash".to_owned(), "push".to_owned()];
    if include_untracked {
        args.push("--include-untracked".to_owned());
    }
    if let Some(message) = message.filter(|value| !value.trim().is_empty()) {
        args.push(format!("--message={message}"));
    }
    args
}

/// `git stash apply <selector>`：保留条目。
pub(crate) fn apply_args(selector: &str) -> Vec<String> {
    vec!["stash".to_owned(), "apply".to_owned(), selector.to_owned()]
}

/// `git stash pop <selector>`：成功后删除条目，冲突时 Git 保留条目。
pub(crate) fn pop_args(selector: &str) -> Vec<String> {
    vec!["stash".to_owned(), "pop".to_owned(), selector.to_owned()]
}

/// `git stash drop <selector>`：只删除指定本地条目。
pub(crate) fn drop_args(selector: &str) -> Vec<String> {
    vec!["stash".to_owned(), "drop".to_owned(), selector.to_owned()]
}

/// 严格解析 `stash@{N}`；N 仅允许非负十进制整数，防止选项注入与自由 ref 名。
pub(crate) fn parse_selector(selector: &str) -> Option<u32> {
    let inner = selector.strip_prefix("stash@{")?.strip_suffix('}')?;
    if inner.is_empty() || !inner.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    inner.parse().ok()
}
