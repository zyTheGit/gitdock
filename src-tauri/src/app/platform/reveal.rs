//! 在系统文件管理器中定位仓库内文件。
//!
//! 安全边界：只接受仓库内相对路径；拒绝绝对路径、`..` 与盘符前缀，拼接后
//! `canonicalize` 再确认仍位于仓库根内（符号链接无法越界），最后由平台适配层
//! 以参数数组启动文件管理器，不经过 shell。

use std::path::{Component, Path, PathBuf};

use git_core::{hide_console, ErrorCode, Result, UserVisibleError};

fn invalid(message: &str, key: &str) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::InvalidArgument, message).with_key(key)
}

/// 把前端传入的相对路径解析为仓库内已存在的绝对路径。
pub fn resolve_in_repo(root: &Path, relative: &str) -> Result<PathBuf> {
    let relative = relative.trim();
    if relative.is_empty() {
        return Err(invalid("文件路径为空", "errors.revealPathInvalid"));
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err(invalid("只允许仓库内相对路径", "errors.revealPathInvalid")
            .with_detail(relative.to_owned()));
    }
    let canon_root = root.canonicalize().map_err(|e| {
        UserVisibleError::new(ErrorCode::Io, "无法解析仓库根目录")
            .with_key("errors.revealRootMissing")
            .with_detail(e.to_string())
    })?;
    let joined = canon_root.join(candidate);
    let target = joined.canonicalize().map_err(|e| {
        UserVisibleError::new(ErrorCode::Io, "文件不存在或无法访问")
            .with_key("errors.revealFileMissing")
            .with_detail(e.to_string())
    })?;
    if !target.starts_with(&canon_root) {
        return Err(invalid("路径超出仓库根目录", "errors.revealPathInvalid")
            .with_detail(relative.to_owned()));
    }
    Ok(target)
}

/// 启动系统文件管理器并选中目标文件；不等待退出。
pub fn reveal(path: &Path) -> Result<()> {
    let mut command = platform_command(path);
    hide_console(&mut command);
    command.spawn().map(|_| ()).map_err(|e| {
        UserVisibleError::new(ErrorCode::ExternalToolFailed, "启动文件管理器失败")
            .with_key("errors.revealLaunchFailed")
            .with_detail(e.to_string())
    })
}

#[cfg(windows)]
fn platform_command(path: &Path) -> std::process::Command {
    let mut command = std::process::Command::new("explorer");
    // explorer 的 /select 与路径必须拼成单个参数，否则含空格的路径会被拆开。
    command.arg(format!("/select,{}", path.display()));
    command
}

#[cfg(target_os = "macos")]
fn platform_command(path: &Path) -> std::process::Command {
    let mut command = std::process::Command::new("open");
    command.arg("-R").arg(path);
    command
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_command(path: &Path) -> std::process::Command {
    // Linux 文件管理器没有统一的“选中文件”接口，退化为打开父目录。
    let mut command = std::process::Command::new("xdg-open");
    command.arg(path.parent().unwrap_or(path));
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "gitdock-reveal-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).expect("创建夹具目录");
        std::fs::write(root.join("src/main.rs"), b"fn main() {}").expect("写入夹具文件");
        root
    }

    #[test]
    fn accepts_relative_path_inside_repo() {
        let root = fixture();
        let resolved = resolve_in_repo(&root, "src/main.rs").expect("仓库内相对路径应通过");
        assert!(resolved.ends_with("main.rs"));
        assert!(resolved.starts_with(root.canonicalize().expect("解析夹具根目录")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_parent_traversal_absolute_and_prefix() {
        let root = fixture();
        for path in ["../outside.txt", "src/../../outside.txt", ""] {
            assert!(
                resolve_in_repo(&root, path).is_err(),
                "应拒绝非法路径：{path}"
            );
        }
        let absolute = root.join("src/main.rs");
        assert!(resolve_in_repo(&root, &absolute.display().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_missing_file() {
        let root = fixture();
        assert!(resolve_in_repo(&root, "src/missing.rs").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
