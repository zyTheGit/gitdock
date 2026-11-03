//! Git 配置值的白名单约束：取值受限键、长度上限与分支名字符校验。

use git_core::{ErrorCode, Result, UserVisibleError};

/// 自由文本值（姓名等）的长度上限（字符数）。
pub(super) const MAX_VALUE_CHARS: usize = 200;

/// 取值受限的键：只接受列出的字面量，布尔开关不接受任意字符串。
const CHOICE_KEYS: [(&str, &[&str]); 2] = [
    ("core.autocrlf", &["true", "false", "input"]),
    ("pull.rebase", &["true", "false", "interactive"]),
];

/// 分支名里不允许出现的字符（配合 `..`、`@{`、`.lock` 等序列检查）。
const FORBIDDEN_IN_BRANCH: [char; 7] = ['~', '^', ':', '?', '*', '[', '\\'];

/// 枚举键的取值可能写成 True / FALSE，统一成界面选项的小写形式；其余原样保留。
pub(super) fn normalize(key: &'static str, value: &str) -> String {
    match CHOICE_KEYS.iter().find(|(name, _)| *name == key) {
        Some((_, choices)) => choices
            .iter()
            .find(|choice| **choice == value.to_lowercase())
            .map(|choice| (*choice).to_owned())
            .unwrap_or_else(|| value.to_owned()),
        None => value.to_owned(),
    }
}

/// 返回去掉首尾空白的值；空值代表删除。控制字符与超长值一律拒绝。
pub(super) fn validate_value(key: &str, raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().any(char::is_control) {
        return Err(invalid(key, "配置值不能包含换行或控制字符"));
    }
    if value.chars().count() > MAX_VALUE_CHARS {
        return Err(invalid(
            key,
            &format!("配置值长度需小于 {MAX_VALUE_CHARS} 个字符"),
        ));
    }
    if let Some((_, choices)) = CHOICE_KEYS.iter().find(|(name, _)| *name == key) {
        let lowered = value.to_lowercase();
        return match choices.iter().find(|choice| **choice == lowered) {
            Some(choice) => Ok((*choice).to_owned()),
            None => Err(invalid(
                key,
                &format!("只能取 {} 之一", choices.join(" / ")),
            )),
        };
    }
    // 姓名允许空格（如 "Jane Doe"），邮箱与分支名不允许；其余键各自单独把关。
    match key {
        "user.email" => {
            if value.chars().any(char::is_whitespace) {
                return Err(invalid(key, "邮箱不能包含空格"));
            }
            if !value.contains('@') || value.starts_with('@') || value.ends_with('@') {
                return Err(invalid(key, "邮箱格式无效，需要包含 @ 且前后有内容"));
            }
        }
        "init.defaultBranch" => {
            if value.chars().any(char::is_whitespace) {
                return Err(invalid(key, "分支名不能包含空格"));
            }
            if value.contains("..")
                || value.contains("@{")
                || value.contains(FORBIDDEN_IN_BRANCH.as_ref())
                || value.starts_with('/')
                || value.ends_with('/')
                || value.ends_with(".lock")
            {
                return Err(invalid(key, "不是合法的分支名"));
            }
        }
        _ => {}
    }
    Ok(value.to_owned())
}

fn invalid(key: &str, message: &str) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::InvalidArgument, format!("{key} {message}"))
}
