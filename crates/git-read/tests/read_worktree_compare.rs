//! 工作区与提交对比（ADR-0030）：文件清单、方向、未跟踪文件与单文件 diff。

mod common;

use common::*;
use git_core::{CompareMode, FileStatus, WorktreeSide};
use test_support::{commit, current_head, git_ok, init_temp_repo, oid_of, temp_dir, write};

fn head_oid(dir: &std::path::Path) -> git_core::Oid {
    oid_of(&current_head(dir))
}

#[test]
fn worktree_vs_commit_lists_every_side() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "modified.txt", "one\n", "base");
    commit(dir, "dropped.txt", "bye\n", "second");

    write(&dir.join("modified.txt"), "one\ntwo\n");
    write(&dir.join("staged.txt"), "staged body\n");
    git_ok(dir, &["add", "staged.txt"]);
    std::fs::remove_file(dir.join("dropped.txt")).expect("删除工作区文件");
    write(&dir.join("untracked.txt"), "loose\n");

    let read = module(dir);
    let head = head_oid(dir);
    let result = read
        .compare_sides(head.as_str(), "worktree", None, false)
        .expect("工作区对比");

    assert_eq!(result.mode, CompareMode::Worktree);
    assert_eq!(result.worktree_side, Some(WorktreeSide::Compare));
    assert_eq!(result.base, head);
    assert_eq!(result.compare, head, "工作区侧回落到 HEAD 占位");
    assert!(result.merge_base.is_none());
    assert_eq!(result.base_only, 0);
    assert_eq!(result.compare_only, 0);
    assert!(result.commits.is_empty());
    assert!(!result.commits_truncated);
    assert!(result.title.contains("工作区"));
    assert!(result.warnings.is_empty());

    let by_path = |path: &str| {
        result
            .files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("缺少文件 {path}"))
    };
    let modified = by_path("modified.txt");
    assert_eq!(modified.status, FileStatus::Modified);
    assert_eq!(modified.additions, 1);
    assert_eq!(modified.deletions, 0);
    assert!(modified.old_oid.is_some());
    assert!(modified.new_oid.is_none(), "工作区侧没有对象 OID");

    assert_eq!(by_path("staged.txt").status, FileStatus::Added);
    assert_eq!(by_path("untracked.txt").status, FileStatus::Added);
    assert_eq!(by_path("dropped.txt").status, FileStatus::Deleted);
    assert_eq!(result.files.len(), 4);
}

#[test]
fn worktree_as_base_reverses_direction() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "file.txt", "one\n", "base");
    write(&dir.join("file.txt"), "one\ntwo\n");
    write(&dir.join("loose.txt"), "loose\n");

    let read = module(dir);
    let head = head_oid(dir);
    let result = read
        .compare_sides("worktree", head.as_str(), None, false)
        .expect("工作区作为 Base");

    assert_eq!(result.worktree_side, Some(WorktreeSide::Base));
    assert_eq!(result.base, head, "工作区侧仍是占位 OID");
    assert_eq!(result.compare, head);
    assert!(result.title.contains("工作区 →"));

    let file = result
        .files
        .iter()
        .find(|item| item.path == "file.txt")
        .expect("file.txt");
    assert_eq!(file.status, FileStatus::Modified);
    assert_eq!(file.additions, 0);
    assert_eq!(file.deletions, 1);

    let loose = result
        .files
        .iter()
        .find(|item| item.path == "loose.txt")
        .expect("loose.txt");
    assert_eq!(
        loose.status,
        FileStatus::Deleted,
        "方向反转后未跟踪文件变为删除"
    );
}

#[test]
fn worktree_file_diff_matches_direction() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "file.txt", "one\ntail\n", "base");
    commit(dir, "gone.txt", "gone\n", "second");
    write(&dir.join("file.txt"), "one\ninserted\ntail\n");
    std::fs::remove_file(dir.join("gone.txt")).expect("删除文件");
    write(&dir.join("fresh.txt"), "fresh body\n");

    let read = module(dir);
    let head = head_oid(dir);

    let forward = read
        .compare_sides_file_diff(head.as_str(), "worktree", "file.txt", false, false)
        .expect("提交 → 工作区 diff");
    let patch = forward.patch.expect("应有 patch");
    assert!(patch.contains("+inserted"), "patch 内容: {patch}");
    assert_eq!(forward.additions, 1);

    let reversed = read
        .compare_sides_file_diff("worktree", head.as_str(), "file.txt", false, false)
        .expect("工作区 → 提交 diff");
    let patch = reversed.patch.expect("应有 patch");
    assert!(patch.contains("-inserted"), "patch 内容: {patch}");
    assert_eq!(reversed.additions, 0);
    assert_eq!(reversed.deletions, 1);

    let added = read
        .compare_sides_file_diff(head.as_str(), "worktree", "fresh.txt", false, false)
        .expect("新增文件 diff");
    assert_eq!(added.status, FileStatus::Added);
    assert!(added.patch.expect("新增应有 patch").contains("+fresh body"));

    let deleted = read
        .compare_sides_file_diff(head.as_str(), "worktree", "gone.txt", false, false)
        .expect("删除文件 diff");
    assert_eq!(deleted.status, FileStatus::Deleted);
    assert!(deleted.patch.expect("删除应有 patch").contains("-gone"));
}

#[test]
fn worktree_file_diff_respects_ignore_whitespace() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "space.txt", "alpha\nbeta\n", "base");
    write(&dir.join("space.txt"), "alpha   \nbeta\n");

    let read = module(dir);
    let head = head_oid(dir);
    let strict = read
        .compare_sides_file_diff(head.as_str(), "worktree", "space.txt", false, false)
        .expect("严格 diff");
    assert!(strict.patch.expect("严格模式有 patch").contains("+alpha"));

    let relaxed = read
        .compare_sides_file_diff(head.as_str(), "worktree", "space.txt", false, true)
        .expect("忽略空白 diff");
    assert_eq!(relaxed.additions, 0);
    assert_eq!(relaxed.note_code.as_deref(), Some("diff_ignore_whitespace"));
}

#[test]
fn content_equal_and_path_filter() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "same.txt", "stable\n", "base");
    commit(dir, "other.txt", "other\n", "second");
    // 暂存后又改回提交内容：内容与提交一致，不应出现在工作区对比中。
    write(&dir.join("same.txt"), "changed\n");
    git_ok(dir, &["add", "same.txt"]);
    write(&dir.join("same.txt"), "stable\n");
    write(&dir.join("other.txt"), "other\nmore\n");

    let read = module(dir);
    let head = head_oid(dir);
    let all = read
        .compare_sides(head.as_str(), "worktree", None, false)
        .expect("工作区对比");
    assert_eq!(all.files.len(), 1, "内容回退的文件不列出");
    assert_eq!(all.files[0].path, "other.txt");

    let filtered = read
        .compare_sides(head.as_str(), "worktree", Some("same"), false)
        .expect("带路径过滤");
    assert!(filtered.files.is_empty());
}

#[test]
fn rejects_both_sides_and_bare_repository() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "a\n", "base");
    let head = head_oid(dir);
    let read = module(dir);

    let both = read
        .compare_sides("worktree", "worktree", None, false)
        .expect_err("两侧都是工作区应报错");
    assert_eq!(both.code, git_core::ErrorCode::InvalidArgument);
    assert_eq!(both.key.as_deref(), Some("errors.readWorktreeBothSides"));

    let bare_root = temp_dir("git-graph-read-bare");
    let bare = bare_root.join("bare.git");
    git_ok(
        dir,
        &[
            "clone",
            "--bare",
            "-q",
            &dir.to_string_lossy(),
            &bare.to_string_lossy(),
        ],
    );
    let bare_read = module(&bare);
    let error = bare_read
        .compare_sides(head.as_str(), "worktree", None, false)
        .expect_err("bare 仓库没有工作区");
    assert_eq!(error.code, git_core::ErrorCode::BareRepository);
    assert_eq!(error.key.as_deref(), Some("errors.readWorktreeUnavailable"));
}
