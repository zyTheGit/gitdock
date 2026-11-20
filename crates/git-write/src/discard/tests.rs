//! 丢弃模块的纯函数与文件系统边界验证（ADR 0026）。

use crate::discard::execute::remove_untracked;
use crate::discard::{nul_pathspec, plan, restore_args, touches_git_dir, unsafe_path_shape};
use crate::staging::safe_rel_path;
use crate::status::StatusEntry;

fn entry(path: &str) -> StatusEntry {
    StatusEntry {
        path: path.to_owned(),
        old_path: None,
        index_code: '.',
        worktree_code: 'M',
        untracked: false,
        conflicted: false,
    }
}

fn untracked(path: &str) -> StatusEntry {
    StatusEntry {
        path: path.to_owned(),
        old_path: None,
        index_code: '?',
        worktree_code: '?',
        untracked: true,
        conflicted: false,
    }
}

fn conflicted(path: &str) -> StatusEntry {
    StatusEntry {
        path: path.to_owned(),
        old_path: None,
        index_code: 'U',
        worktree_code: 'U',
        untracked: false,
        conflicted: true,
    }
}

#[test]
fn plan_separates_tracked_and_untracked_in_request_order() {
    let entries = vec![entry("a.txt"), untracked("b.txt"), entry("c.txt")];
    let split = plan(
        &entries,
        &["b.txt".to_owned(), "a.txt".to_owned(), "b.txt".to_owned()],
    );
    assert_eq!(split.tracked, vec!["a.txt".to_owned()]);
    assert_eq!(split.untracked, vec!["b.txt".to_owned()]);
    assert_eq!(split.total(), 2);
}

#[test]
fn plan_skips_conflicted_clean_and_unknown_paths() {
    let mut clean = entry("clean.txt");
    clean.worktree_code = '.';
    let entries = vec![conflicted("conflict.txt"), clean, entry("dirty.txt")];
    let empty = plan(
        &entries,
        &[
            "conflict.txt".to_owned(),
            "clean.txt".to_owned(),
            "gone.txt".to_owned(),
        ],
    );
    assert_eq!(empty, crate::discard::DiscardPlan::default());
    // 只有工作区有改动的条目会进入 tracked。
    let dirty = plan(&entries, &["dirty.txt".to_owned()]);
    assert_eq!(dirty.tracked, vec!["dirty.txt".to_owned()]);
    assert!(dirty.untracked.is_empty());
}

#[test]
fn restore_args_only_touch_the_worktree() {
    assert_eq!(
        restore_args(),
        vec![
            "restore",
            "--worktree",
            "--pathspec-from-file=-",
            "--pathspec-file-nul"
        ]
    );
    // 不允许出现 `--staged` / `--source`：索引与已暂存内容必须保持原样。
    assert!(!restore_args().iter().any(|arg| arg == "--staged"));
}

#[test]
fn nul_pathspec_terminates_each_path() {
    let bytes = nul_pathspec(&["a b.txt".to_owned(), "中文.txt".to_owned()]);
    assert_eq!(bytes, b"a b.txt\0\xe4\xb8\xad\xe6\x96\x87.txt\0".to_vec());
}

#[test]
fn path_guards_reject_absolute_option_like_and_git_dir() {
    for path in ["C:/outside.txt", "C:outside.txt", "//server/share", "a\0b"] {
        assert!(unsafe_path_shape(path), "{path}");
    }
    // 选项注入与穿越由 safe_rel_path 拒绝（Gate 两者都会跑）。
    for path in ["-rf", "-x", "../outside.txt", "a\\b.txt", "/abs.txt"] {
        assert!(!safe_rel_path(path), "{path}");
    }
    assert!(touches_git_dir(".git"));
    assert!(touches_git_dir(".GIT/config"));
    assert!(!touches_git_dir("src/.gitignore"));
    assert!(!unsafe_path_shape("src/main.rs"));
    assert!(safe_rel_path("src/main.rs"));
}

#[test]
fn remove_untracked_deletes_only_regular_files() {
    let temp = tempfile::TempDir::new().expect("临时目录");
    let root = std::fs::canonicalize(temp.path()).expect("规范化根目录");
    std::fs::write(root.join("ok.txt"), "x").expect("写入文件");
    std::fs::create_dir(root.join("dir")).expect("创建目录");

    remove_untracked(&root, "ok.txt").expect("删除普通文件");
    assert!(!root.join("ok.txt").exists());

    // 目录、以及任何 `.git` 内部路径都不在能力范围内。
    assert!(remove_untracked(&root, "dir").is_err());
    assert!(remove_untracked(&root, ".git/config").is_err());
    assert!(remove_untracked(&root, "missing.txt").is_err());
    assert!(root.join("dir").is_dir());
}
