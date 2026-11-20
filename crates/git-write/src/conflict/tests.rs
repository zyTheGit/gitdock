//! 冲突解决模块的纯函数与命令形态验证（ADR-0033）。
//!
//! 真正的 Git 行为在集成测试 `tests/write_conflict.rs`；这里钉住参数形态、
//! 路径校验与残留标记扫描的边界，避免契约在重构中悄悄跑偏。

use git_core::WriteKind;

use crate::conflict::gate::path_issue;
use crate::conflict::{
    find_conflict_marker, read_for_marker_scan, ConflictAction, MAX_MARKER_SCAN_BYTES,
};

fn assert_args(action: ConflictAction, path: &str, expected: &[&str]) {
    let actual = action.args(path);
    let actual: Vec<&str> = actual.iter().map(String::as_str).collect();
    assert_eq!(actual, expected, "{action:?}");
}

#[test]
fn args_are_arrays_with_double_dash_before_path() {
    assert_args(
        ConflictAction::Ours,
        "src/a.rs",
        &["checkout", "--ours", "--", "src/a.rs"],
    );
    assert_args(
        ConflictAction::Theirs,
        "src/a.rs",
        &["checkout", "--theirs", "--", "src/a.rs"],
    );
    assert_args(
        ConflictAction::MarkResolved,
        "src/a.rs",
        &["add", "--", "src/a.rs"],
    );
    // 单路径：参数里不会出现 `-A`、`-u` 等会扩大作用域的开关。
    assert!(!ConflictAction::MarkResolved
        .args("a.txt")
        .iter()
        .any(|arg| arg.starts_with("-A") || arg == "-u"));
}

#[test]
fn from_kind_maps_only_the_three_conflict_kinds() {
    assert_eq!(
        ConflictAction::from_kind(WriteKind::ResolveConflictOurs),
        Some(ConflictAction::Ours)
    );
    assert_eq!(
        ConflictAction::from_kind(WriteKind::ResolveConflictTheirs),
        Some(ConflictAction::Theirs)
    );
    assert_eq!(
        ConflictAction::from_kind(WriteKind::MarkConflictResolved),
        Some(ConflictAction::MarkResolved)
    );
    for other in [
        WriteKind::Reset,
        WriteKind::DiscardFiles,
        WriteKind::StageHunk,
        WriteKind::ContinueOperation,
    ] {
        assert!(ConflictAction::from_kind(other).is_none(), "{other:?}");
    }
}

#[test]
fn path_issue_rejects_missing_absolute_traversal_and_git_dir() {
    let missing = path_issue("").expect("空路径必须拒绝");
    assert_eq!(missing.code, "gate_conflict_path_required");

    for path in [
        "/abs.txt",
        "C:/outside.txt",
        "//server/share",
        "../outside.txt",
        "a/../../b.txt",
        "a\\b.txt",
        "-rf",
        "a\nb.txt",
        "a\rb.txt",
        "a\u{7}b.txt",
    ] {
        let problem = path_issue(path).unwrap_or_else(|| panic!("{path:?} 必须拒绝"));
        assert_eq!(problem.code, "gate_invalid_path", "{path:?}");
        assert!(
            problem
                .args
                .as_ref()
                .is_some_and(|args| args.contains_key("path")),
            "{path:?}"
        );
    }

    let git_dir = path_issue(".git/config").expect(".git 路径必须拒绝");
    assert_eq!(git_dir.code, "gate_git_dir_path");

    for path in ["a.txt", "src/a.rs", "中文 文件.txt"] {
        assert!(path_issue(path).is_none(), "{path}");
    }
}

#[test]
fn marker_scan_only_matches_line_starts() {
    let conflict = "a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> feature\n";
    assert_eq!(find_conflict_marker(conflict), Some("<<<<<<<"));
    assert_eq!(
        find_conflict_marker("a\n>>>>>>> feature\n"),
        Some(">>>>>>>")
    );
    assert_eq!(find_conflict_marker("a\n=======\nc\n"), Some("======="));

    // 缩进、行内出现或只是前后缀都不算行首标记。
    assert_eq!(find_conflict_marker("  <<<<<<< HEAD\n"), None);
    assert_eq!(find_conflict_marker("x ======= y\n"), None);
    assert_eq!(find_conflict_marker("<<<<<<\n"), None);
    assert_eq!(find_conflict_marker("a\nb\nc\n"), None);
}

#[test]
fn marker_scan_skips_binary_oversize_and_missing_files() {
    let temp = tempfile::TempDir::new().expect("临时目录");
    let root = temp.path();
    std::fs::write(root.join("text.txt"), "a\n<<<<<<< HEAD\nb\n").expect("写入");
    assert_eq!(
        read_for_marker_scan(root, "text.txt").as_deref(),
        Some("a\n<<<<<<< HEAD\nb\n")
    );

    // 含 NUL 视为二进制：跳过扫描（None），不误报。
    std::fs::write(root.join("bin.dat"), b"a\n<<<<<<< HEAD\n\0").expect("写入二进制");
    assert!(read_for_marker_scan(root, "bin.dat").is_none());

    // 超过上限同样跳过；上限之内的文本仍会被扫描。
    let oversize = vec![b'a'; (MAX_MARKER_SCAN_BYTES + 1) as usize];
    std::fs::write(root.join("big.txt"), &oversize).expect("写入大文件");
    assert!(read_for_marker_scan(root, "big.txt").is_none());

    assert!(read_for_marker_scan(root, "missing.txt").is_none());
    assert!(read_for_marker_scan(root, "../outside.txt").is_none());
}
