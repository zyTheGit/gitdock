//! 手动 stash 的行为验证（ADR 0009）。

use git_core::{GateReportDto, WriteKind, WriteRequest, WriteStatus};
use test_support::{commit, git_ok, init_temp_repo, write};

use crate::GitWriteModule;

fn base_request(kind: WriteKind) -> WriteRequest {
    WriteRequest {
        kind,
        oid: None,
        branch: None,
        new_name: None,
        description: None,
        paths: None,
        interruption: None,
        mainline: None,
        message: None,
        stash: None,
        include_untracked: None,
        pull_mode: None,
        oids: None,
    }
}

fn save_request(message: Option<&str>, include_untracked: bool) -> WriteRequest {
    WriteRequest {
        message: message.map(str::to_owned),
        include_untracked: Some(include_untracked),
        ..base_request(WriteKind::StashSave)
    }
}

fn selector_request(kind: WriteKind, selector: &str) -> WriteRequest {
    WriteRequest {
        stash: Some(selector.to_owned()),
        ..base_request(kind)
    }
}

fn issue_codes(report: &GateReportDto) -> Vec<&str> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect()
}

fn stash_count(dir: &std::path::Path) -> usize {
    let listing = git_ok(dir, &["stash", "list", "--format=%gd"]);
    if listing.is_empty() {
        0
    } else {
        listing.lines().count()
    }
}

fn clean_status(dir: &std::path::Path) -> String {
    git_ok(dir, &["status", "--porcelain"])
}

#[test]
fn save_tracked_changes_creates_stash_and_cleans_worktree() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("a.txt"), "changed\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&save_request(Some("试验改动"), false))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryStashSave")
    );

    let outcome = module
        .execute(&save_request(Some("试验改动"), false))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(stash_count(dir), 1);
    assert!(clean_status(dir).is_empty(), "{}", clean_status(dir));
    assert_eq!(
        git_ok(dir, &["stash", "list", "--format=%gs"]),
        "On main: 试验改动"
    );
}

#[test]
fn save_untracked_requires_explicit_option() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("new.txt"), "new\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module.validate(&save_request(None, false)).expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_stash_untracked_only"));

    let outcome = module.execute(&save_request(None, true)).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(stash_count(dir), 1);
    assert!(!dir.join("new.txt").exists());
}

#[test]
fn save_empty_worktree_is_rejected() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module.validate(&save_request(None, false)).expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_stash_nothing"));
}

#[test]
fn apply_keeps_entry_and_restores_changes() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("a.txt"), "stashed\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    module
        .execute(&save_request(None, false))
        .expect("保存 stash");

    let outcome = module
        .execute(&selector_request(WriteKind::StashApply, "stash@{0}"))
        .expect("apply");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(stash_count(dir), 1);
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "stashed\n"
    );
}

#[test]
fn pop_success_removes_entry() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("a.txt"), "stashed\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    module
        .execute(&save_request(None, false))
        .expect("保存 stash");

    let outcome = module
        .execute(&selector_request(WriteKind::StashPop, "stash@{0}"))
        .expect("pop");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(stash_count(dir), 0);
}

#[test]
fn pop_conflict_is_reported_and_entry_is_kept() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("a.txt"), "stashed\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    module
        .execute(&save_request(None, false))
        .expect("保存 stash");
    // 让当前提交改同一行，pop 时必然产生三方合并冲突。
    commit(dir, "a.txt", "other\n", "c2");

    let outcome = module
        .execute(&selector_request(WriteKind::StashPop, "stash@{0}"))
        .expect("pop");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    assert!(!outcome.conflict_files.is_empty());
    assert_eq!(stash_count(dir), 1, "冲突时 Git 应保留 stash 条目");

    // 清理冲突态，避免临时目录残留影响后续断言。
    let _ = git_ok(dir, &["reset", "--hard", "HEAD"]);
}

#[test]
fn drop_removes_only_selected_entry() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    write(&dir.join("a.txt"), "first\n");
    module
        .execute(&save_request(Some("first"), false))
        .expect("第一个 stash");
    write(&dir.join("a.txt"), "second\n");
    module
        .execute(&save_request(Some("second"), false))
        .expect("第二个 stash");
    assert_eq!(stash_count(dir), 2);

    let outcome = module
        .execute(&selector_request(WriteKind::StashDrop, "stash@{1}"))
        .expect("drop");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(stash_count(dir), 1);
    assert_eq!(
        git_ok(dir, &["stash", "list", "--format=%gs"]),
        "On main: second"
    );
}

#[test]
fn selector_gate_rejects_invalid_and_out_of_range() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&selector_request(WriteKind::StashApply, "HEAD"))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_stash_selector_invalid"));

    let report = module
        .validate(&selector_request(WriteKind::StashDrop, "stash@{0}"))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_stash_not_found"));
}
