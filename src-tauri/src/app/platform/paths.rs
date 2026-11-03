//! 路径语义与 PATH 工具函数的平台差异。

/// PATH 查找只保留绝对路径条目：相对条目与 "." 会随进程当前目录解析，
/// 仓库内伪造的同名可执行文件可能先于系统目录命中（当前目录劫持）。
/// 消费方：LazyGit 解析（terminal.rs）与 Linux 工具探测（tools.rs）。
pub(crate) fn absolute_path_entries(paths: &std::ffi::OsStr) -> Vec<std::path::PathBuf> {
    std::env::split_paths(paths)
        .filter(|dir| dir.is_absolute())
        .collect()
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
}
