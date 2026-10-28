//! 外部 diff 工具：模板解析为参数数组，进程启动不经 shell。
//!
//! 安全边界：前端只能传入已保存工具的索引与文件路径，可执行文件与模板始终
//! 来自设置；变量替换只产生单个完整参数，路径中的空白、中文、引号不会被拆分。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git_core::{ErrorCode, UserVisibleError};

use super::config::ExternalToolConfig;

pub const DEFAULT_TEMPLATE: &str = "$LOCAL $REMOTE";

/// 按空白切分模板，单/双引号只用于包裹含空白的参数。
pub fn build_args(
    template: &str,
    local: &str,
    remote: &str,
) -> Result<Vec<String>, UserVisibleError> {
    let template = if template.trim().is_empty() {
        DEFAULT_TEMPLATE
    } else {
        template
    };
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for ch in template.chars() {
        match quote {
            Some(q) => {
                started = true;
                if ch == q {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None if ch == '"' || ch == '\'' => {
                started = true;
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if started {
                    args.push(substitute(&current, local, remote)?);
                    current.clear();
                    started = false;
                }
            }
            None => {
                started = true;
                current.push(ch);
            }
        }
    }
    if quote.is_some() {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "外部工具参数模板引号未闭合",
        ));
    }
    if started {
        args.push(substitute(&current, local, remote)?);
    }
    if args.is_empty() {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "外部工具参数模板为空",
        ));
    }
    Ok(args)
}

fn substitute(token: &str, local: &str, remote: &str) -> Result<String, UserVisibleError> {
    match token {
        "$LOCAL" => Ok(local.to_owned()),
        "$REMOTE" => Ok(remote.to_owned()),
        other if other.contains("$LOCAL") || other.contains("$REMOTE") => {
            Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "模板变量 $LOCAL / $REMOTE 必须独占一个参数",
            ))
        }
        other => Ok(other.to_owned()),
    }
}

/// 为一次外部 diff 调用创建独立的临时目录。
pub fn prepare_dir(root: &Path, _path: &str) -> Result<PathBuf, UserVisibleError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = root.join(format!("{nanos}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| {
        UserVisibleError::new(ErrorCode::Io, "创建外部 diff 临时目录失败")
            .with_detail(e.to_string())
    })?;
    Ok(dir)
}

/// 仅保留文件名中的字母数字与常见扩展名字符，避免任意路径进入临时目录。
pub fn safe_file_name(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or("file");
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.trim_matches('.').is_empty() {
        "file".to_owned()
    } else {
        cleaned
    }
}

/// 以可执行文件 + 参数数组启动；不等待退出，也不经过 shell。
pub fn launch(
    tool: &ExternalToolConfig,
    local: &Path,
    remote: &Path,
) -> Result<(), UserVisibleError> {
    let args = build_args(
        &tool.args_template,
        &local.display().to_string(),
        &remote.display().to_string(),
    )?;
    std::process::Command::new(&tool.executable)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            UserVisibleError::new(
                ErrorCode::ExternalToolFailed,
                format!("启动外部工具失败：{}", tool.name),
            )
            .with_detail(e.to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_template_defaults_to_both_paths() {
        let args = build_args("", r"C:\a b\左.txt", r"C:\a b\右.txt").unwrap();
        assert_eq!(args, vec![r"C:\a b\左.txt", r"C:\a b\右.txt"]);
    }

    #[test]
    fn quoted_tokens_stay_single_argument() {
        let args = build_args(r#"--wait "$LOCAL" "$REMOTE""#, "L 1", "R \"2\"").unwrap();
        assert_eq!(args, vec!["--wait", "L 1", "R \"2\""]);
    }

    #[test]
    fn chinese_and_spaces_are_preserved() {
        let args = build_args(
            "$LOCAL $REMOTE",
            "C:\\项目\\旧 文件.txt",
            "C:\\项目\\新 文件.txt",
        )
        .unwrap();
        assert_eq!(args[0], "C:\\项目\\旧 文件.txt");
        assert_eq!(args[1], "C:\\项目\\新 文件.txt");
    }

    #[test]
    fn embedded_variable_is_rejected() {
        assert!(build_args("--file=$LOCAL $REMOTE", "a", "b").is_err());
    }

    #[test]
    fn unclosed_quote_is_rejected() {
        assert!(build_args("$LOCAL \"$REMOTE", "a", "b").is_err());
    }
}
