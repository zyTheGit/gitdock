//! 丢弃未暂存改动与删除未跟踪文件（ADR 0026）。

mod common;

use common::*;
use git_core::{WriteKind, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

#[test]
fn discard_tracked_restores_worktree_from_index_only() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("a.txt"), "staged\n");
    git_ok(dir, &["add", "a.txt"]);
    write(&dir.join("a.txt"), "worktree-only\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&staging_request(WriteKind::DiscardFiles, &["a.txt"]))
        .expect("丢弃");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");

    // 工作区回到 index 内容，已暂存改动（staged\n）完整保留。
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).expect("文件仍在"),
        "staged\n"
    );
    // `git_ok` 已裁剪输出首尾空白，索引内容断言用裁剪后的形态。
    assert_eq!(git_ok(dir, &["show", ":a.txt"]), "staged");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status.staged.iter().any(|file| file.path == "a.txt"));
    assert!(!status.unstaged.iter().any(|file| file.path == "a.txt"));
}

#[test]
fn discard_untracked_deletes_only_selected_files() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, ".gitignore", "ignored.txt\n", "base");
    write(&dir.join("ignored.txt"), "keep\n");
    write(&dir.join("中文 文件.txt"), "temp\n");
    write(&dir.join("keep me.txt"), "keep\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = staging_request(WriteKind::DiscardFiles, &["中文 文件.txt"]);

    // Gate 报告受影响清单与破坏性 warning，供确认框展示。
    let gate = module.validate(&request).expect("Gate");
    assert!(gate.ok, "{gate:?}");
    assert_eq!(gate.affected_paths, vec!["中文 文件.txt".to_owned()]);
    assert_eq!(gate.affected_total, 1);
    assert!(gate
        .warnings
        .iter()
        .any(|w| w.code == "discard_destructive"));

    let outcome = module.execute(&request).expect("丢弃");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!dir.join("中文 文件.txt").exists());
    // 其他未跟踪文件与被忽略文件毫发无损。
    assert!(dir.join("keep me.txt").exists());
    assert_eq!(
        std::fs::read_to_string(dir.join("ignored.txt")).expect("忽略文件仍在"),
        "keep\n"
    );
}

#[test]
fn discard_mixed_selection_handles_both_kinds_in_one_request() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "tracked.txt", "base\n", "base");
    write(&dir.join("tracked.txt"), "dirty\n");
    write(&dir.join("new.txt"), "new\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&staging_request(
            WriteKind::DiscardFiles,
            &["tracked.txt", "new.txt"],
        ))
        .expect("丢弃");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        std::fs::read_to_string(dir.join("tracked.txt")).expect("文件仍在"),
        "base\n"
    );
    assert!(!dir.join("new.txt").exists());
}

#[test]
fn discard_rejects_conflict_and_interruption_states() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let picked = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行 cherry-pick");
    assert_eq!(picked.status, WriteStatus::Conflicted, "{picked:?}");

    let conflict = std::fs::read_to_string(dir.join("conflict.txt")).expect("冲突文件");
    let outcome = module
        .execute(&staging_request(WriteKind::DiscardFiles, &["conflict.txt"]))
        .expect("Gate");
    assert_eq!(outcome.status, WriteStatus::Rejected, "{outcome:?}");
    // 拒绝后工作区零改动：冲突标记原样保留。
    assert_eq!(
        std::fs::read_to_string(dir.join("conflict.txt")).expect("冲突文件仍在"),
        conflict
    );
}

#[test]
fn discard_rejects_paths_outside_status_and_traversal_forms() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("a.txt"), "dirty\n");
    write(&dir.join("staged.txt"), "x\n");
    git_ok(dir, &["add", "staged.txt"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    for path in [
        "../outside.txt",
        "C:/outside.txt",
        "a\\..\\b.txt",
        "-rf",
        ".git/config",
        "missing.txt",
        "staged.txt",
    ] {
        let outcome = module
            .execute(&staging_request(WriteKind::DiscardFiles, &[path]))
            .expect("Gate");
        assert_eq!(outcome.status, WriteStatus::Rejected, "{path}: {outcome:?}");
    }
    // 只有已暂存改动的文件必须先取消暂存，不得被丢弃。
    assert_eq!(
        std::fs::read_to_string(dir.join("staged.txt")).expect("已暂存文件仍在"),
        "x\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).expect("未触碰的文件仍在"),
        "dirty\n"
    );
}

#[test]
fn discard_rejects_untracked_directories_and_empty_selection() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    std::fs::create_dir(dir.join("newdir")).expect("创建未跟踪目录");
    write(&dir.join("newdir").join("inner.txt"), "x\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let gate = module
        .validate(&staging_request(WriteKind::DiscardFiles, &["newdir/"]))
        .expect("Gate");
    assert!(!gate.ok);
    assert!(gate
        .issues
        .iter()
        .any(|issue| issue.code == "gate_untracked_directory"));

    let outcome = module
        .execute(&staging_request(WriteKind::DiscardFiles, &[]))
        .expect("Gate");
    assert_eq!(outcome.status, WriteStatus::Rejected);
    assert!(dir.join("newdir").join("inner.txt").exists());
}
