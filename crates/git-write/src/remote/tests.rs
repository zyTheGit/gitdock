//! 远程基础操作行为验证（ADR 0010）。

use std::path::{Path, PathBuf};

use git_core::{GateReportDto, WriteKind, WriteRequest, WriteStatus};
use test_support::{commit, git_ok, init_temp_repo, temp_dir, write};

use crate::execute::remote_failure;
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

fn issue_codes(report: &GateReportDto) -> Vec<&str> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect()
}

fn configure(dir: &Path) {
    for (key, value) in [
        ("user.name", "Test"),
        ("user.email", "test@example.com"),
        ("core.autocrlf", "false"),
        ("commit.gpgSign", "false"),
    ] {
        git_ok(dir, &["config", key, value]);
    }
}

fn clone_remote(remote: &Path, prefix: &str) -> PathBuf {
    let parent = temp_dir(prefix);
    let local = parent.join("repo");
    let remote_str = remote.to_string_lossy().into_owned();
    git_ok(
        &parent,
        &["-c", "core.autocrlf=false", "clone", &remote_str, "repo"],
    );
    configure(&local);
    local
}

/// 建立 bare remote + 本地 clone，返回 (local, remote)。
fn setup(prefix: &str) -> (PathBuf, PathBuf) {
    let source = init_temp_repo();
    commit(source.path(), "a.txt", "base\n", "c1");
    let remote = temp_dir(&format!("{prefix}-remote"));
    git_ok(&remote, &["init", "--bare", "-b", "main"]);
    let remote_str = remote.to_string_lossy().into_owned();
    git_ok(source.path(), &["remote", "add", "origin", &remote_str]);
    git_ok(source.path(), &["push", "-u", "origin", "main"]);
    let local = clone_remote(&remote, &format!("{prefix}-local"));
    (local, remote)
}

fn other_pushes(remote: &Path, prefix: &str, file: &str, content: &str, message: &str) -> String {
    let other = clone_remote(remote, prefix);
    let head = commit(&other, file, content, message);
    git_ok(&other, &["push"]);
    head
}

#[test]
fn fetch_updates_remote_tracking_ref() {
    let (local, remote) = setup("remote-fetch");
    let remote_head = other_pushes(&remote, "remote-fetch-other", "b.txt", "b\n", "c2");
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let outcome = module
        .execute(&base_request(WriteKind::Fetch))
        .expect("fetch");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(&local, &["rev-parse", "refs/remotes/origin/main"]),
        remote_head
    );
}

#[test]
fn pull_ff_only_fast_forwards_worktree() {
    let (local, remote) = setup("remote-pull");
    let remote_head = other_pushes(&remote, "remote-pull-other", "b.txt", "b\n", "c2");
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let outcome = module
        .execute(&base_request(WriteKind::Pull))
        .expect("pull");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(&local, &["rev-parse", "HEAD"]), remote_head);
    assert_eq!(std::fs::read_to_string(local.join("b.txt")).unwrap(), "b\n");
}

#[test]
fn pull_gate_rejects_dirty_worktree() {
    let (local, _remote) = setup("remote-dirty");
    write(&local.join("a.txt"), "dirty\n");
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let report = module
        .validate(&base_request(WriteKind::Pull))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_remote_dirty_pull"));
}

#[test]
fn push_updates_remote_branch() {
    let (local, remote) = setup("remote-push");
    write(&local.join("b.txt"), "b\n");
    let local_head = commit(&local, "b.txt", "b\n", "c2");
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let outcome = module
        .execute(&base_request(WriteKind::Push))
        .expect("push");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(&remote, &["rev-parse", "refs/heads/main"]),
        local_head
    );
}

#[test]
fn push_rejects_non_fast_forward() {
    let (local, remote) = setup("remote-reject");
    other_pushes(&remote, "remote-reject-other", "b.txt", "b\n", "c2");
    write(&local.join("c.txt"), "c\n");
    commit(&local, "c.txt", "c\n", "c3");
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let outcome = module
        .execute(&base_request(WriteKind::Push))
        .expect("push");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomePushRejected"));
}

#[test]
fn gate_rejects_missing_remote_and_upstream() {
    let temp = init_temp_repo();
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");
    commit(temp.path(), "a.txt", "base\n", "c1");

    let report = module
        .validate(&base_request(WriteKind::Fetch))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_remote_missing"));

    for kind in [WriteKind::Pull, WriteKind::Push] {
        let report = module.validate(&base_request(kind)).expect("Gate");
        assert!(
            issue_codes(&report).contains(&"gate_remote_no_upstream"),
            "{kind:?}: {:?}",
            report.issues
        );
    }
}

#[test]
fn gate_rejects_detached_pull() {
    let (local, _remote) = setup("remote-detached");
    git_ok(&local, &["checkout", "--detach", "HEAD"]);
    let module = GitWriteModule::new(&local).expect("打开写模块");

    let report = module
        .validate(&base_request(WriteKind::Pull))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_remote_detached"));
}

#[test]
fn classifies_auth_and_direction_failures() {
    assert_eq!(
        remote_failure(
            WriteKind::Fetch,
            "fatal: Authentication failed for 'https://x'"
        )
        .map(|(_, key)| key),
        Some("errors.outcomeRemoteAuthFailed")
    );
    assert_eq!(
        remote_failure(
            WriteKind::Pull,
            "fatal: Not possible to fast-forward, aborting."
        )
        .map(|(_, key)| key),
        Some("errors.outcomePullNotFastForward")
    );
    assert_eq!(
        remote_failure(
            WriteKind::Push,
            "! [rejected] main -> main (non-fast-forward)"
        )
        .map(|(_, key)| key),
        Some("errors.outcomePushRejected")
    );
}
