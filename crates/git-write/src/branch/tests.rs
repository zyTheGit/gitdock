//! 分支创建、删除与重命名的行为验证（ADR 0008）。

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

fn create_request(branch: &str, oid: Option<&str>) -> WriteRequest {
    WriteRequest {
        oid: oid.map(|value| Oid::new(value).expect("oid")),
        branch: Some(branch.to_owned()),
        ..base_request(WriteKind::CreateBranch)
    }
}

fn delete_request(branch: &str) -> WriteRequest {
    WriteRequest {
        branch: Some(branch.to_owned()),
        ..base_request(WriteKind::DeleteBranch)
    }
}

fn rename_request(branch: &str, new_name: &str) -> WriteRequest {
    WriteRequest {
        branch: Some(branch.to_owned()),
        new_name: Some(new_name.to_owned()),
        ..base_request(WriteKind::RenameBranch)
    }
}

fn issue_codes(report: &GateReportDto) -> Vec<&str> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect()
}

fn ref_exists(dir: &std::path::Path, reference: &str) -> bool {
    std::process::Command::new("git")
        .current_dir(dir)
        .args(["show-ref", "--verify", "--quiet", reference])
        .status()
        .expect("启动 git show-ref")
        .success()
}

#[test]
fn create_branch_from_head_keeps_current_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let head = commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&create_request("topic", None))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryBranchCreate")
    );

    let outcome = module
        .execute(&create_request("topic", None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    // 独立核对：新分支指向 HEAD，当前分支未切换。
    assert_eq!(git_ok(dir, &["rev-parse", "refs/heads/topic"]), head);
    assert_eq!(git_ok(dir, &["symbolic-ref", "--short", "HEAD"]), "main");
}

#[test]
fn create_branch_at_specific_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let first = commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&create_request("topic", Some(&first)))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(dir, &["rev-parse", "refs/heads/topic"]), first);
}

#[test]
fn create_branch_gate_rejects_existing_invalid_and_unborn() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["branch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&create_request("topic", None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_branch_exists"));

    let report = module
        .validate(&create_request("bad name", None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_invalid_branch_name"));

    let unborn = init_temp_repo();
    let module = GitWriteModule::new(unborn.path()).expect("打开写模块");
    let report = module
        .validate(&create_request("topic", None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_unborn_head_branch"));
}

#[test]
fn delete_merged_branch_succeeds() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["branch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module.execute(&delete_request("topic")).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!ref_exists(dir, "refs/heads/topic"));
}

#[test]
fn delete_gate_rejects_current_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module.validate(&delete_request("main")).expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_branch_current"));
}

#[test]
fn delete_unmerged_branch_is_refused_and_kept() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["switch", "-c", "feature"]);
    commit(dir, "feature.txt", "f\n", "feature 提交");
    git_ok(dir, &["switch", "main"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module.execute(&delete_request("feature")).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert_eq!(
        outcome.key.as_deref(),
        Some("errors.outcomeBranchDeleteRejected")
    );
    // 未合并分支必须保留。
    assert!(ref_exists(dir, "refs/heads/feature"));
}

#[test]
fn rename_branch_moves_ref() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let head = commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["branch", "old"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&rename_request("old", "new"))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryBranchRename")
    );

    let outcome = module.execute(&rename_request("old", "new")).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!ref_exists(dir, "refs/heads/old"));
    assert_eq!(git_ok(dir, &["rev-parse", "refs/heads/new"]), head);
}

#[test]
fn rename_current_branch_updates_head_reference() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&rename_request("main", "trunk"))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(dir, &["symbolic-ref", "--short", "HEAD"]), "trunk");
}

#[test]
fn rename_gate_rejects_same_and_existing_names() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["branch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&rename_request("topic", "topic"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_branch_rename_same"));

    let report = module
        .validate(&rename_request("topic", "main"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_branch_exists"));

    let report = module
        .validate(&rename_request("topic", "-bad"))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_invalid_branch_name"));
}

#[test]
fn create_branch_from_unborn_but_staged_repo_is_refused() {
    // unborn HEAD 下即使有暂存文件也没有可命名的起点提交。
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("a.txt"), "one\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&create_request("topic", None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_unborn_head_branch"));
}
