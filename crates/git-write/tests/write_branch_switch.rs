//! 分支切换：Gate 拒绝条件、脏工作区携带与覆盖失败回退。

mod common;

use std::process::Command;

use common::*;
use git_core::{WriteKind, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

#[test]
fn switch_requires_existing_local_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git_ok(dir, &["branch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let missing = module
        .validate(&request(
            WriteKind::SwitchBranch,
            None,
            Some("remotenothere"),
            None,
        ))
        .expect("Gate");
    assert!(!missing.ok);
    assert!(missing
        .issues
        .iter()
        .any(|issue| issue.code == "gate_branch_not_found"));

    let current = module
        .validate(&request(WriteKind::SwitchBranch, None, Some("main"), None))
        .expect("Gate");
    assert!(current
        .issues
        .iter()
        .any(|issue| issue.code == "gate_already_on_branch"));

    let outcome = module
        .execute(&request(WriteKind::SwitchBranch, None, Some("topic"), None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );
}

#[test]
fn switch_rejects_worktree_occupied_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git_ok(dir, &["branch", "occupied"]);
    let linked = temp.path().join("linked");
    git_ok(
        dir,
        &[
            "worktree",
            "add",
            linked.to_str().expect("UTF-8 路径"),
            "occupied",
        ],
    );

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(
            WriteKind::SwitchBranch,
            None,
            Some("occupied"),
            None,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_branch_checked_out"));
}

#[test]
fn switch_carries_dirty_changes_with_warning() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "tracked.txt", "base\n", "base");
    git_ok(dir, &["branch", "topic"]);
    write(&dir.join("staged.txt"), "staged\n");
    git_ok(dir, &["add", "staged.txt"]);
    write(&dir.join("tracked.txt"), "base\nlocal\n");
    write(&dir.join("new.txt"), "new\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(WriteKind::SwitchBranch, None, Some("topic"), None);
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "dirty 切换应在确认后允许：{:?}", report.issues);
    assert!(report.issues.is_empty());
    assert!(report
        .warnings
        .iter()
        .any(|warning| warning.code == "worktree_dirty"));
    assert_eq!(report.affected_total, 3);
    let mut paths = report.affected_paths.clone();
    paths.sort();
    assert_eq!(paths, vec!["new.txt", "staged.txt", "tracked.txt"]);
    assert!(report.summary.contains("3 个有改动的文件"));

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(
        outcome.message.contains("改动已保留"),
        "{}",
        outcome.message
    );
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("tracked.txt")).expect("读取文件"),
        "base\nlocal\n"
    );
    let status = git_ok(dir, &["status", "--porcelain=v2"]);
    assert!(status.contains("1 A. "), "{status}");
    assert!(status.contains("1 .M "), "{status}");
    assert!(status.contains("? new.txt"), "{status}");
}

#[test]
fn switch_overwrite_failure_preserves_dirty_changes() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "shared.txt", "base\n", "base");
    git_ok(dir, &["switch", "-c", "topic"]);
    commit(dir, "shared.txt", "topic\n", "topic 修改");
    git_ok(dir, &["switch", "main"]);
    write(&dir.join("shared.txt"), "local\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(WriteKind::SwitchBranch, None, Some("topic"), None);
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "覆盖风险由 Git 判定：{:?}", report.issues);
    assert_eq!(report.affected_paths, vec!["shared.txt".to_owned()]);

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert!(
        outcome
            .stderr
            .as_deref()
            .unwrap_or("")
            .contains("would be overwritten"),
        "stderr：{:?}",
        outcome.stderr
    );
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("shared.txt")).expect("读取文件"),
        "local\n"
    );
    assert!(git_ok(dir, &["status", "--porcelain=v2"]).contains("1 .M "));
}

#[test]
fn switch_rejects_unmerged_index_without_operation_marker() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "f.txt", "a\nb\nc\n", "base");
    git_ok(dir, &["switch", "-c", "topic"]);
    commit(dir, "f.txt", "a\ntopic\nc\n", "topic 修改");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "f.txt", "a\nmain\nc\n", "main 修改");
    let merge = Command::new("git")
        .current_dir(dir)
        .args(["merge", "topic"])
        .output()
        .expect("启动 git merge");
    assert!(!merge.status.success(), "merge 应产生冲突");
    // 模拟没有操作标记但索引仍未合并的残留状态。
    std::fs::remove_file(dir.join(".git").join("MERGE_HEAD")).expect("删除 MERGE_HEAD");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(WriteKind::SwitchBranch, None, Some("topic"), None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_conflicted_index_switch"));
}
