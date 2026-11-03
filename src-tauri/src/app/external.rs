//! 外部 diff 工具：模板解析为参数数组，进程启动不经 shell。
//!
//! 安全边界：前端只能传入已保存工具的索引与文件路径，可执行文件与模板始终
//! 来自设置；变量替换只产生单个完整参数，路径中的空白、中文、引号不会被拆分。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git_core::{hide_console, ErrorCode, UserVisibleError};

use super::config::ExternalToolConfig;
use super::logging;

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

/// 应用启动时清空外部 diff 临时根目录下的全部历史条目。
///
/// 上次会话残留的临时目录既占用缓存，又让工作副本内容在磁盘上的留盘时间
/// 不可控；单个条目删除失败仅记日志告警、不阻断启动，根目录不存在时静默跳过。
pub fn cleanup_root(root: &Path) {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        // 根目录尚未创建：本机从未用过外部 diff，无需清理。
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return,
        Err(err) => {
            logging::warn(&format!("读取外部 diff 临时根目录失败：{err}"));
            return;
        }
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if remove_entry_logged(&path, is_dir) {
            removed += 1;
        }
    }
    if removed > 0 {
        logging::info(&format!("启动清理：已删除外部 diff 残留条目 {removed} 个"));
    }
}

/// 删除单个残留条目；条目已不存在视为成功。
/// 失败仅记日志告警、不向上传播错误；返回是否清理成功。
fn remove_entry_logged(path: &Path, is_dir: bool) -> bool {
    let result = if is_dir {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match result {
        Ok(()) => true,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => true,
        Err(err) => {
            logging::warn(&format!(
                "清理外部 diff 临时条目失败：{}（{err}）",
                path.display()
            ));
            false
        }
    }
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

/// 以可执行文件 + 参数数组启动，不经过 shell，也不同步等待退出。
/// 后台线程等待工具退出后删除本次临时目录，删除失败由下次启动清理兜底。
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
    let mut command = std::process::Command::new(&tool.executable);
    // 从 VS Code / Electron 环境继承 ELECTRON_RUN_AS_NODE 时，VS Code、Zed 等
    // Electron 工具会按纯 Node 进程启动并立即退出，表现为“打开无反应”。
    command.env_remove("ELECTRON_RUN_AS_NODE");
    command.args(&args);
    // 控制台工具（如 where.exe）从 GUI 进程启动会弹出终端窗口。
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        UserVisibleError::new(
            ErrorCode::ExternalToolFailed,
            format!("启动外部工具失败：{}", tool.name),
        )
        .with_detail(e.to_string())
    })?;
    // 临时目录即两个参数文件所在目录；等待外部工具退出后再删除，
    // 缩短工作副本内容在缓存目录的留盘时间。
    let dir = local.parent().map(Path::to_path_buf);
    let cleaner = std::thread::Builder::new()
        .name("external-diff-cleanup".to_owned())
        .stack_size(64 * 1024)
        .spawn(move || {
            let _ = child.wait();
            if let Some(dir) = dir.as_deref() {
                remove_entry_logged(dir, true);
            }
        });
    if cleaner.is_err() {
        // 等待线程启动失败时子进程句柄随闭包释放（不终止工具进程），
        // 本次临时目录留待下次启动清理。
        logging::warn("启动外部 diff 清理线程失败，临时目录将留待下次启动清理");
    }
    Ok(())
}

/// 用默认浏览器打开 URL；URL 必须由后端按固定模板构造，不接受前端任意协议。
pub fn open_url(url: &str) -> Result<(), UserVisibleError> {
    #[cfg(windows)]
    let (program, args): (&str, Vec<&str>) =
        ("rundll32.exe", vec!["url.dll,FileProtocolHandler", url]);
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![url]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![url]);
    let mut command = std::process::Command::new(program);
    command.args(args);
    hide_console(&mut command);
    command.spawn().map(|_| ()).map_err(|e| {
        UserVisibleError::new(ErrorCode::ExternalToolFailed, "打开默认浏览器失败")
            .with_detail(e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

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

    /// 历史子目录（内含 local-/remote- 临时文件）与根下散落文件全部删除。
    #[test]
    fn cleanup_root_removes_stale_subdirs_and_files() {
        let root = TempDir::new().unwrap();
        let external = root.path().join("external-diff");
        for name in ["1700000000000000000-1234", "1700000000999999999-5678"] {
            let dir = external.join(name);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("local-a.txt"), b"old").unwrap();
            fs::write(dir.join("remote-a.txt"), b"new").unwrap();
        }
        fs::write(external.join("stray.txt"), b"stray").unwrap();
        cleanup_root(&external);
        let remaining: Vec<_> = fs::read_dir(&external)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(
            remaining.is_empty(),
            "清理后根目录应为空，实际剩余：{remaining:?}"
        );
    }

    /// 子目录内的嵌套结构随整个子目录递归删除。
    #[test]
    fn cleanup_root_removes_nested_content() {
        let root = TempDir::new().unwrap();
        let external = root.path().join("external-diff");
        let stale = external.join("1700000000000000000-1234").join("inner");
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("local-a.txt"), b"old").unwrap();
        cleanup_root(&external);
        assert!(!external.join("1700000000000000000-1234").exists());
    }

    /// 根目录不存在（从未用过外部 diff）时静默跳过，不报错也不创建目录。
    #[test]
    fn cleanup_root_silently_skips_missing_root() {
        let root = TempDir::new().unwrap();
        let external = root.path().join("external-diff");
        cleanup_root(&external);
        assert!(!external.exists());
    }
}
