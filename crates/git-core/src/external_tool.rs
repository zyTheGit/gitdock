use crate::error::{ErrorCode, Result, UserVisibleError};

/// 将参数模板拆分为独立参数。
///
/// 规则：
/// - 引号（单/双）内外的空白不分割；引号本身不进入结果。
/// - 不做变量展开、不解释 `$`、通配符或反引号。
/// - 变量占位符在拆分之后替换，保证含空格/中文/引号的路径仍是单个参数。
/// - 反斜杠按字面保留（Windows 路径），只有双引号内的 `\"` 视为转义引号。
pub fn split_args_template(template: &str) -> Result<Vec<String>> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut has_token = false;
    let mut chars = template.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_double => {
                in_single = !in_single;
                has_token = true;
            }
            '"' if !in_single => {
                in_double = !in_double;
                has_token = true;
            }
            '\\' if in_double => {
                if let Some('"') = chars.peek() {
                    chars.next();
                    current.push('"');
                } else {
                    current.push('\\');
                }
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if has_token {
                    args.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }

    if in_single || in_double {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "外部工具参数模板存在未闭合的引号",
        )
        .with_key("errors.externalArgsUnclosedQuote"));
    }
    if has_token {
        args.push(current);
    }
    Ok(args)
}

/// 先拆分参数，再替换 $LOCAL / $REMOTE 占位符。
pub fn render_args_template(template: &str, local: &str, remote: &str) -> Result<Vec<String>> {
    let args = split_args_template(template)?;
    Ok(args
        .into_iter()
        .map(|arg| arg.replace("$LOCAL", local).replace("$REMOTE", remote))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_arguments() {
        assert_eq!(
            split_args_template("--diff --wait").unwrap(),
            vec!["--diff", "--wait"]
        );
    }

    #[test]
    fn keeps_spaced_paths_as_single_argument() {
        let local = r"C:\Users\me\My Documents\旧 版本\a b.txt";
        let remote = r"C:\Temp\新 版本\c.txt";
        let args = render_args_template(r#""$LOCAL" "$REMOTE""#, local, remote).unwrap();
        assert_eq!(args, vec![local.to_owned(), remote.to_owned()]);
    }

    #[test]
    fn supports_prefix_inside_argument() {
        let args = render_args_template("--file=$LOCAL", "/tmp/a b", "/tmp/c").unwrap();
        assert_eq!(args, vec!["--file=/tmp/a b"]);
    }

    #[test]
    fn quotes_and_chinese_are_literal() {
        let local = r#"/tmp/"weird name".txt"#;
        let args = render_args_template(r#"--left "$LOCAL""#, local, "/tmp/r").unwrap();
        assert_eq!(args[0], "--left");
        assert_eq!(args[1], local);
    }

    #[test]
    fn rejects_unclosed_quote() {
        assert!(split_args_template("\"abc").is_err());
    }

    #[test]
    fn empty_template_yields_no_args() {
        assert!(split_args_template("   ").unwrap().is_empty());
    }
}
