//! 本地标签创建与删除的行为验证（ADR 0008）。

use git_core::{GateReportDto, Oid, WriteKind, WriteRequest, WriteStatus};
use test_support::{commit, git_ok, init_temp_repo};

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
    }
}

fn create_request(tag: &str, oid: Option<&str>, message: Option<&str>) -> WriteRequest {
    WriteRequest {
        oid: oid.map(|value| Oid::new(value).expect("oid")),
        branch: Some(tag.to_owned()),
        message: message.map(str::to_owned),
        ..base_request(WriteKind::CreateTag)
    }
}

fn delete_request(tag: &str) -> WriteRequest {
    WriteRequest {
        branch: Some(tag.to_owned()),
        ..base_request(WriteKind::DeleteTag)
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
fn create_lightweight_tag_points_to_head() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let head = commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&create_request("v1", None, None))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryTagCreate")
    );

    let outcome = module
        .execute(&create_request("v1", None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    // 独立核对：轻量标签直接指向 commit。
    assert_eq!(git_ok(dir, &["cat-file", "-t", "refs/tags/v1"]), "commit");
    assert_eq!(git_ok(dir, &["rev-parse", "refs/tags/v1"]), head);
}

#[test]
fn create_annotated_tag_with_multiline_message() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let message = "版本说明\n\n- 第一条\n- 第二条";

    let gate = module
        .validate(&create_request("v1", None, Some(message)))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryTagCreateAnnotated")
    );

    let outcome = module
        .execute(&create_request("v1", None, Some(message)))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    // 独立核对：附注标签为 tag 对象，内容保真。
    assert_eq!(git_ok(dir, &["cat-file", "-t", "refs/tags/v1"]), "tag");
    assert_eq!(
        git_ok(
            dir,
            &["for-each-ref", "--format=%(contents)", "refs/tags/v1"]
        )
        .trim_end(),
        message
    );
}

#[test]
fn create_tag_at_specific_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let first = commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&create_request("v1", Some(&first), None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(dir, &["rev-parse", "refs/tags/v1^{}"]), first);
}

#[test]
fn delete_local_tag_succeeds() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["tag", "v1"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module.execute(&delete_request("v1")).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!ref_exists(dir, "refs/tags/v1"));
}

#[test]
fn tag_gate_rejects_duplicate_invalid_and_unborn() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    git_ok(dir, &["tag", "v1"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&create_request("v1", None, None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_tag_exists"));

    let report = module
        .validate(&create_request("bad tag", None, None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_invalid_tag_name"));

    let unborn = init_temp_repo();
    let module = GitWriteModule::new(unborn.path()).expect("打开写模块");
    let report = module
        .validate(&create_request("v1", None, None))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_unborn_head_tag"));
}

#[test]
fn delete_missing_tag_is_rejected() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module.validate(&delete_request("v1")).expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_tag_missing"));
}
