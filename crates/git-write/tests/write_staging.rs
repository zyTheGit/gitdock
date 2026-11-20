//! 暂存区状态读取、批量暂存 / 取消暂存与单文件 diff。

mod common;

use common::*;
use git_core::{FileStatus, WriteKind, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

#[test]
fn staging_status_separates_staged_and_unstaged() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    write(&dir.join("a.txt"), "two\n");
    write(&dir.join("b.txt"), "new\n");
    git_ok(dir, &["add", "b.txt"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "b.txt" && file.status == FileStatus::Added));
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "a.txt" && file.status == FileStatus::Modified));
    assert!(!status.staged.iter().any(|file| file.path == "a.txt"));
    let unstaged = status
        .unstaged
        .iter()
        .find(|file| file.path == "a.txt")
        .expect("未暂存条目");
    assert!(unstaged.additions > 0);
}

#[test]
fn stage_and_unstage_round_trip_preserves_content() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("u.txt"), "hello\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["u.txt"]))
        .expect("暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status.staged.iter().any(|file| file.path == "u.txt"));

    let diff = module
        .staging_file_diff("u.txt", true, false)
        .expect("staged diff");
    assert_eq!(diff.status, FileStatus::Added);
    assert!(diff.patch.as_deref().unwrap_or("").contains("+hello"));

    let outcome = module
        .execute(&staging_request(WriteKind::UnstageFiles, &["u.txt"]))
        .expect("取消暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "u.txt" && file.untracked));
    assert_eq!(
        std::fs::read_to_string(dir.join("u.txt")).expect("文件仍在"),
        "hello\n"
    );
}

#[test]
fn batch_stage_handles_deletion_and_new_file() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    std::fs::remove_file(dir.join("a.txt")).expect("删除工作区文件");
    write(&dir.join("new.txt"), "new\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&staging_request(
            WriteKind::StageFiles,
            &["a.txt", "new.txt"],
        ))
        .expect("批量暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "a.txt" && file.status == FileStatus::Deleted));
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "new.txt" && file.status == FileStatus::Added));
}

#[test]
fn staged_rename_diff_uses_old_and_new_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "old.txt", "same\ncontent\n", "base");
    git_ok(dir, &["mv", "old.txt", "new.txt"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let status = module.staging_status().expect("暂存区状态");
    let entry = status
        .staged
        .iter()
        .find(|file| file.path == "new.txt")
        .expect("重命名条目");
    assert_eq!(entry.status, FileStatus::Renamed);
    assert_eq!(entry.old_path.as_deref(), Some("old.txt"));

    let diff = module
        .staging_file_diff("new.txt", true, false)
        .expect("staged diff");
    let patch = diff.patch.as_deref().unwrap_or("");
    assert!(patch.contains("rename from old.txt"), "{patch}");
}

#[test]
fn unstage_on_unborn_head_keeps_untracked_file() {
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("first.txt"), "first\n");
    git_ok(dir, &["add", "first.txt"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let status = module.staging_status().expect("暂存区状态");
    assert!(status.unborn);
    assert!(status.staged.iter().any(|file| file.path == "first.txt"));

    let outcome = module
        .execute(&staging_request(WriteKind::UnstageFiles, &["first.txt"]))
        .expect("取消暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "first.txt" && file.untracked));
    assert!(dir.join("first.txt").exists());
}

#[test]
fn staging_diff_can_ignore_whitespace() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "space.txt", "alpha\nbeta\n", "base");
    write(&dir.join("space.txt"), "alpha   \nbeta\n");
    // 未跟踪文件同样支持忽略空白（走 --no-index 路径）。
    write(&dir.join("loose.txt"), "gamma  \ndelta\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let strict = module
        .staging_file_diff("space.txt", false, false)
        .expect("严格 diff");
    assert!(strict.patch.as_deref().unwrap_or("").contains("+alpha"));

    let relaxed = module
        .staging_file_diff("space.txt", false, true)
        .expect("忽略空白 diff");
    assert_eq!(relaxed.additions, 0);
    assert_eq!(relaxed.note_code.as_deref(), Some("diff_ignore_whitespace"));

    let untracked = module
        .staging_file_diff("loose.txt", false, true)
        .expect("未跟踪文件忽略空白");
    assert_eq!(untracked.status, FileStatus::Added);
    assert!(untracked.patch.as_deref().unwrap_or("").contains("+gamma"));
}

#[test]
fn staging_rejects_invalid_and_unknown_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    for path in ["../outside.txt", "C:/outside.txt", "missing.txt"] {
        let outcome = module
            .execute(&staging_request(WriteKind::StageFiles, &[path]))
            .expect("Gate");
        assert_eq!(outcome.status, WriteStatus::Rejected, "{path}: {outcome:?}");
    }
}

#[test]
fn conflicted_files_are_listed_and_excluded_from_groups() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted);

    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .conflicted_files
        .iter()
        .any(|file| file == "conflict.txt"));
    assert!(!status.staged.iter().any(|file| file.path == "conflict.txt"));
    assert!(!status
        .unstaged
        .iter()
        .any(|file| file.path == "conflict.txt"));

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["conflict.txt"]))
        .expect("Gate");
    assert_eq!(outcome.status, WriteStatus::Rejected);
}
