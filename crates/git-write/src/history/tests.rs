//! merge / rebase / 批量 pick 的行为验证（ADR 0011）。

use git_core::{GateReportDto, Oid, WriteKind, WriteRequest, WriteStatus};
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

fn branch_request(kind: WriteKind, branch: &str) -> WriteRequest {
    WriteRequest {
        branch: Some(branch.to_owned()),
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

#[test]
fn merge_non_fast_forward_creates_merge_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["switch", "-c", "feature"]);
    commit(dir, "b.txt", "b\n", "c2");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "c.txt", "c\n", "c3");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&branch_request(WriteKind::Merge, "feature"))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);

    let outcome = module
        .execute(&branch_request(WriteKind::Merge, "feature"))
        .expect("merge");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let parents = git_ok(dir, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    assert_eq!(parents.split_whitespace().count(), 3, "{parents}");
    assert!(dir.join("b.txt").exists() && dir.join("c.txt").exists());
}

#[test]
fn merge_conflict_is_reported() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["switch", "-c", "feature"]);
    commit(dir, "a.txt", "feature\n", "c2");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "a.txt", "main\n", "c3");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&branch_request(WriteKind::Merge, "feature"))
        .expect("merge");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    assert!(!outcome.conflict_files.is_empty());
    assert!(dir.join(".git").join("MERGE_HEAD").exists());
    let _ = git_ok(dir, &["merge", "--abort"]);
}

#[test]
fn merge_gate_rejects_self_dirty_and_detached() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&branch_request(WriteKind::Merge, "main"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_remote_branch_self"));

    write(&dir.join("a.txt"), "dirty\n");
    let report = module
        .validate(&branch_request(WriteKind::Merge, "main"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_remote_dirty_history"));
    let _ = git_ok(dir, &["reset", "--hard", "HEAD"]);

    git_ok(dir, &["checkout", "--detach", "HEAD"]);
    let report = module
        .validate(&branch_request(WriteKind::Rebase, "main"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_detached_head"));
}

#[test]
fn rebase_moves_topic_onto_target() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["switch", "-c", "topic"]);
    commit(dir, "topic.txt", "t\n", "c2");
    git_ok(dir, &["switch", "main"]);
    let main_head = commit(dir, "main.txt", "m\n", "c3");
    git_ok(dir, &["switch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&branch_request(WriteKind::Rebase, "main"))
        .expect("rebase");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD~1"]), main_head);
    assert!(dir.join("topic.txt").exists() && dir.join("main.txt").exists());
}

#[test]
fn cherry_pick_multiple_commits() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["switch", "-c", "feature"]);
    let first = commit(dir, "one.txt", "1\n", "c2");
    let second = commit(dir, "two.txt", "2\n", "c3");
    git_ok(dir, &["switch", "main"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let request = WriteRequest {
        oids: Some(vec![
            Oid::new(&first).expect("oid"),
            Oid::new(&second).expect("oid"),
        ]),
        ..base_request(WriteKind::CherryPick)
    };
    let gate = module.validate(&request).expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);

    let outcome = module.execute(&request).expect("cherry-pick");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(dir.join("one.txt").exists() && dir.join("two.txt").exists());
    let log = git_ok(dir, &["log", "--format=%s", "-3"]);
    assert_eq!(log, "c3\nc2\nc1");
}
