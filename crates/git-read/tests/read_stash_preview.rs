//! 单条 stash 的文件预览（ADR-0030）：tracked 改动、`stash -u` 未跟踪文件与忽略空白。

mod common;

use common::*;
use git_core::{FileStatus, Oid};
use test_support::{commit, git_ok, init_temp_repo, oid_of, read_oid, write};

fn stash_oid(dir: &std::path::Path, rev: &str) -> Oid {
    oid_of(&read_oid(dir, rev))
}

#[test]
fn stash_detail_merges_tracked_changes() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "keep.txt", "one\n", "base");
    commit(dir, "drop.txt", "gone\n", "second");
    write(&dir.join("keep.txt"), "one\ntwo\n");
    git_ok(dir, &["add", "keep.txt"]);
    write(&dir.join("added.txt"), "brand new\n");
    git_ok(dir, &["add", "added.txt"]);
    git_ok(dir, &["rm", "-q", "drop.txt"]);
    git_ok(dir, &["stash", "push", "-m", "preview"]);

    let read = module(dir);
    let oid = stash_oid(dir, "stash@{0}");
    let detail = read.read_stash_detail(&oid).expect("读取 stash 详情");
    assert_eq!(detail.oid, oid);
    assert!(!detail.includes_untracked);
    assert!(!detail.truncated);
    assert!(detail.warnings.is_empty());

    let by_path = |path: &str| {
        detail
            .files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("缺少文件 {path}"))
    };
    assert_eq!(by_path("keep.txt").status, FileStatus::Modified);
    assert_eq!(by_path("keep.txt").additions, 1);
    assert_eq!(by_path("keep.txt").deletions, 0);
    assert_eq!(by_path("added.txt").status, FileStatus::Added);
    assert_eq!(by_path("drop.txt").status, FileStatus::Deleted);

    let diff = read
        .read_stash_file_diff(&oid, "keep.txt", false)
        .expect("tracked 文件 diff");
    let patch = diff.patch.expect("文本 diff 应有 patch");
    assert!(patch.contains("+two"), "patch 内容: {patch}");
    assert_eq!(diff.additions, 1);
}

#[test]
fn stash_detail_includes_untracked_tree() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "tracked.txt", "base\n", "base");
    write(&dir.join("tracked.txt"), "base\nnext\n");
    write(&dir.join("scratch.txt"), "untracked body\n");
    git_ok(dir, &["stash", "push", "-u", "-m", "with-untracked"]);

    let read = module(dir);
    let oid = stash_oid(dir, "stash@{0}");
    let detail = read
        .read_stash_detail(&oid)
        .expect("读取含未跟踪文件的 stash");
    assert!(detail.includes_untracked);

    let tracked = detail
        .files
        .iter()
        .find(|file| file.path == "tracked.txt")
        .expect("tracked 改动仍在");
    assert_eq!(tracked.status, FileStatus::Modified);

    let untracked = detail
        .files
        .iter()
        .find(|file| file.path == "scratch.txt")
        .expect("第 3 父树的未跟踪文件");
    assert_eq!(untracked.status, FileStatus::Added);
    assert_eq!(untracked.additions, 1);

    // 未跟踪文件落在第 3 父树，diff 回落到该树读取。
    let diff = read
        .read_stash_file_diff(&oid, "scratch.txt", false)
        .expect("未跟踪文件 diff");
    assert_eq!(diff.status, FileStatus::Added);
    let patch = diff.patch.expect("未跟踪文件应有 patch");
    assert!(patch.contains("+untracked body"), "patch 内容: {patch}");

    // 不存在的路径仍然是 FileNotFound。
    let missing = read
        .read_stash_file_diff(&oid, "nope.txt", false)
        .expect_err("缺失路径应报错");
    assert_eq!(missing.code, git_core::ErrorCode::FileNotFound);
}

#[test]
fn stash_detail_rejects_root_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "root.txt", "root\n", "root");
    let root = stash_oid(dir, "HEAD");

    let read = module(dir);
    let error = read
        .read_stash_detail(&root)
        .expect_err("根提交不是 stash 形状");
    assert_eq!(error.code, git_core::ErrorCode::InvalidArgument);
    assert_eq!(error.key.as_deref(), Some("errors.readNotAStashCommit"));
}

#[test]
fn stash_file_diff_ignores_whitespace_when_asked() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "space.txt", "alpha\nbeta\n", "base");
    write(&dir.join("space.txt"), "alpha  \nbeta\n");
    git_ok(dir, &["stash", "push", "-m", "whitespace"]);

    let read = module(dir);
    let oid = stash_oid(dir, "stash@{0}");
    let strict = read
        .read_stash_file_diff(&oid, "space.txt", false)
        .expect("严格模式 diff");
    assert!(strict.additions > 0);

    let relaxed = read
        .read_stash_file_diff(&oid, "space.txt", true)
        .expect("忽略空白 diff");
    assert_eq!(relaxed.additions, 0);
    assert_eq!(relaxed.deletions, 0);
    assert_eq!(relaxed.note_code.as_deref(), Some("diff_ignore_whitespace"));
}
