//! 路径语义与 PATH 工具函数的平台差异。

use std::path::{Path, PathBuf};

/// PATH 查找只保留绝对路径条目：相对条目与 "." 会随进程当前目录解析，
/// 仓库内伪造的同名可执行文件可能先于系统目录命中（当前目录劫持）。
/// 消费方：LazyGit 解析（terminal.rs）与 Linux 工具探测（tools.rs）。
pub(crate) fn absolute_path_entries(paths: &std::ffi::OsStr) -> Vec<PathBuf> {
    std::env::split_paths(paths)
        .filter(|dir| dir.is_absolute())
        .collect()
}

/// 合并已有 `PATH` 与追加目录：保留原有顺序，仅补充尚未出现的绝对目录。
#[cfg(any(target_os = "macos", test))]
pub(crate) fn merge_path_entries(
    existing: Option<&std::ffi::OsStr>,
    extras: &[PathBuf],
) -> Option<std::ffi::OsString> {
    let mut merged: Vec<PathBuf> = existing
        .map(|raw| {
            std::env::split_paths(raw)
                .filter(|p| !p.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_default();
    let initial_len = merged.len();
    for dir in extras {
        if !dir.is_absolute() {
            continue;
        }
        let already = merged.iter().any(|item| same_path_entry(item, dir));
        if !already {
            merged.push(dir.clone());
        }
    }
    if merged.len() == initial_len {
        return None;
    }
    std::env::join_paths(merged).ok()
}

#[cfg(any(target_os = "macos", test))]
fn same_path_entry(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    } else {
        a == b
    }
}

/// 探测 VS Code `.app` 内置的 ripgrep (`rg`) 目录，供 macOS GUI 启动 `bin/code` 时兜底写入 PATH。
#[cfg(any(target_os = "macos", test))]
pub(crate) fn find_vscode_bundled_rg_dir(executable: &Path, arch: &str) -> Option<PathBuf> {
    let file_name = executable.file_name()?.to_str()?;
    if !matches!(file_name, "code" | "code-insiders") {
        return None;
    }
    let bin_dir = executable.parent()?;
    if bin_dir.file_name()?.to_str()? != "bin" {
        return None;
    }
    let app_root = bin_dir.parent()?;
    if app_root.file_name()?.to_str()? != "app" {
        return None;
    }
    let darwin_arch = match arch {
        "aarch64" => "darwin-arm64",
        "x86_64" => "darwin-x64",
        _ => "darwin-arm64",
    };
    let candidates = [
        app_root
            .join("node_modules")
            .join("@vscode")
            .join("ripgrep-universal")
            .join("bin")
            .join(darwin_arch),
        app_root
            .join("node_modules.asar.unpacked")
            .join("@vscode")
            .join("ripgrep-universal")
            .join("bin")
            .join(darwin_arch),
        app_root
            .join("node_modules")
            .join("@vscode")
            .join("ripgrep")
            .join("bin"),
        app_root
            .join("node_modules.asar.unpacked")
            .join("@vscode")
            .join("ripgrep")
            .join("bin"),
        app_root
            .join("node_modules")
            .join("vscode-ripgrep")
            .join("bin"),
        app_root
            .join("node_modules.asar.unpacked")
            .join("vscode-ripgrep")
            .join("bin"),
    ];
    candidates.into_iter().find(|dir| dir.join("rg").is_file())
}

#[cfg(target_os = "macos")]
fn read_path_lines(file: &Path, out: &mut Vec<PathBuf>) {
    let Ok(content) = std::fs::read_to_string(file) else {
        return;
    };
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let candidate = PathBuf::from(trimmed);
        if candidate.is_absolute() && candidate.is_dir() {
            out.push(candidate);
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_extra_path_dirs(executable: &Path) -> Vec<PathBuf> {
    let mut extras = Vec::new();
    for dir in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
    ] {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            extras.push(path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for rel in [".local/bin", ".cargo/bin"] {
            let path = home.join(rel);
            if path.is_dir() {
                extras.push(path);
            }
        }
    }
    read_path_lines(Path::new("/etc/paths"), &mut extras);
    if let Ok(entries) = std::fs::read_dir("/etc/paths.d") {
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .collect();
        files.sort();
        for file in files {
            read_path_lines(&file, &mut extras);
        }
    }
    if let Some(rg_dir) = find_vscode_bundled_rg_dir(executable, std::env::consts::ARCH) {
        extras.push(rg_dir);
    }
    extras
}

/// 为外部对比工具子进程补全平台环境（macOS GUI 进程继承 launchd 极简 PATH，
/// 启动 VS Code CLI 时 `VSCODE_CLI=1` 会跳过登录 shell 读取，需预先补齐常见工具目录）。
pub(crate) fn configure_external_tool_env(command: &mut std::process::Command, executable: &Path) {
    #[cfg(target_os = "macos")]
    {
        let extras = macos_extra_path_dirs(executable);
        if let Some(merged) = merge_path_entries(std::env::var_os("PATH").as_deref(), &extras) {
            command.env("PATH", merged);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (command, executable);
    }
}

/// 最近仓库列表的去重比较。
///
/// Linux 文件系统大小写敏感：`/home/u/Repo` 与 `/home/u/repo` 是两个真实
/// 仓库，折叠会错误去重（G2 差距清单 A-3）。Windows 与 macOS 默认卷不敏
/// 感，沿用「分隔符归一 + 小写折叠」的历史行为，保持既有列表不漂移。
pub(crate) fn same_path(a: &str, b: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        let _ = (a, b);
        a == b
    }
    #[cfg(not(target_os = "linux"))]
    {
        let normalize = |value: &str| value.replace('\\', "/").to_lowercase();
        normalize(a) == normalize(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn windows_and_mac_fold_case_and_separators() {
        assert!(same_path(r"C:\Repo", "c:/repo"));
        assert!(!same_path(r"C:\Repo", "c:/repo2"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_compares_exactly() {
        assert!(same_path("/home/u/Repo", "/home/u/Repo"));
        assert!(!same_path("/home/u/Repo", "/home/u/repo"));
    }

    #[test]
    fn path_entries_drop_relative_and_dot() {
        let raw = if cfg!(windows) {
            r"C:\Tools;.;relative;C:\Bin"
        } else {
            "/opt/tools:.:relative:/usr/local/bin"
        };
        let entries = absolute_path_entries(std::ffi::OsStr::new(raw));
        assert!(entries.iter().all(|dir| dir.is_absolute()));
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn merge_path_entries_appends_unique_extras_in_order() {
        let existing = if cfg!(windows) {
            r"C:\Windows\System32;C:\Bin"
        } else {
            "/usr/bin:/bin"
        };
        let extras = if cfg!(windows) {
            vec![
                PathBuf::from(r"c:\bin"),
                PathBuf::from(r"C:\Tools"),
                PathBuf::from("relative"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("relative"),
            ]
        };
        let merged = merge_path_entries(Some(std::ffi::OsStr::new(existing)), &extras)
            .expect("应追加去重后的额外目录");
        let list: Vec<_> = std::env::split_paths(&merged).collect();
        if cfg!(windows) {
            assert_eq!(
                list,
                vec![
                    PathBuf::from(r"C:\Windows\System32"),
                    PathBuf::from(r"C:\Bin"),
                    PathBuf::from(r"C:\Tools"),
                ]
            );
        } else {
            assert_eq!(
                list,
                vec![
                    PathBuf::from("/usr/bin"),
                    PathBuf::from("/bin"),
                    PathBuf::from("/opt/homebrew/bin"),
                ]
            );
        }
    }

    #[test]
    fn merge_path_entries_returns_none_when_all_extras_present() {
        let existing = if cfg!(windows) {
            r"C:\Bin"
        } else {
            "/opt/homebrew/bin"
        };
        let extra = PathBuf::from(existing);
        assert!(merge_path_entries(Some(std::ffi::OsStr::new(existing)), &[extra]).is_none());
    }

    #[test]
    fn find_vscode_bundled_rg_dir_locates_universal_and_legacy_layouts() {
        let temp = tempfile::TempDir::new().expect("创建临时目录");
        let app_root = temp
            .path()
            .join("Visual Studio Code.app")
            .join("Contents")
            .join("Resources")
            .join("app");
        let cli = app_root.join("bin").join("code");
        std::fs::create_dir_all(cli.parent().unwrap()).unwrap();
        std::fs::write(&cli, b"").unwrap();

        // 1. 新版 universal 布局
        let universal_dir = app_root
            .join("node_modules.asar.unpacked")
            .join("@vscode")
            .join("ripgrep-universal")
            .join("bin")
            .join("darwin-arm64");
        std::fs::create_dir_all(&universal_dir).unwrap();
        std::fs::write(universal_dir.join("rg"), b"").unwrap();
        assert_eq!(
            find_vscode_bundled_rg_dir(&cli, "aarch64"),
            Some(universal_dir.clone())
        );

        // 2. 旧版 @vscode/ripgrep 布局（移除 universal 后回退）
        std::fs::remove_file(universal_dir.join("rg")).unwrap();
        let legacy_dir = app_root
            .join("node_modules.asar.unpacked")
            .join("@vscode")
            .join("ripgrep")
            .join("bin");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("rg"), b"").unwrap();
        assert_eq!(
            find_vscode_bundled_rg_dir(&cli, "aarch64"),
            Some(legacy_dir)
        );
    }
}
