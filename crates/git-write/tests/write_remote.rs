//! 远程跟踪分支检出、首次推送、fetch --prune 与标签推送（ADR-0028）。
//!
//! 全部使用本地 bare 仓库充当 remote，不访问网络。

mod common;

use std::path::Path;

use common::*;
use git_core::{GateReportDto, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, temp_dir, write};

fn issue_codes(report: &GateReportDto) -> Vec<&str> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect()
}

fn branch_request(kind: WriteKind, branch: &str) -> WriteRequest {
    request(kind, None, Some(branch), None)
}

fn ref_exists(dir: &Path, reference: &str) -> bool {
    std::process::Command::new("git")
        .current_dir(dir)
        .args(["show-ref", "--verify", "--quiet", reference])
        .status()
        .expect("启动 git show-ref")
        .success()
}

#[test]
fn checkout_remote_branch_creates_tracking_local_branch() {
    let sandbox = remote_sandbox("write-remote-checkout");
    let (source, local) = (sandbox.source(), sandbox.local());
    git_ok(source, &["branch", "feat-a"]);
    git_ok(source, &["push", "origin", "feat-a"]);
    git_ok(local, &["fetch", "origin"]);

    let module = GitWriteModule::new(local).expect("打开写模块");
    let request = branch_request(WriteKind::CheckoutRemoteBranch, "origin/feat-a");
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert_eq!(
        report.summary_key.as_deref(),
        Some("errors.gateSummaryCheckoutRemote")
    );
    assert!(report.summary.contains("feat-a"), "{}", report.summary);

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        outcome.key.as_deref(),
        Some("errors.outcomeCheckedOutRemoteBranch")
    );
    assert_eq!(
        git_ok(local, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "feat-a"
    );
    // `--track` 建立的上游：remote + merge 与远程分支一一对应。
    assert_eq!(
        git_ok(local, &["config", "branch.feat-a.remote"]).trim(),
        "origin"
    );
    assert_eq!(
        git_ok(local, &["config", "branch.feat-a.merge"]).trim(),
        "refs/heads/feat-a"
    );
}

#[test]
fn checkout_remote_branch_keeps_dirty_changes_and_accepts_custom_name() {
    let sandbox = remote_sandbox("write-remote-checkout-dirty");
    let (source, local) = (sandbox.source(), sandbox.local());
    git_ok(source, &["branch", "feat-b"]);
    git_ok(source, &["push", "origin", "feat-b"]);
    git_ok(local, &["fetch", "origin"]);
    // feat-b 与 main 指向同一提交，改动不会冲突：ADR-0002 语义下 warning 放行。
    write(&local.join("a.txt"), "base\nlocal\n");

    let module = GitWriteModule::new(local).expect("打开写模块");
    let request = WriteRequest {
        branch: Some("origin/feat-b".to_owned()),
        new_name: Some("local-b".to_owned()),
        ..base_request(WriteKind::CheckoutRemoteBranch)
    };
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert!(report
        .warnings
        .iter()
        .any(|warning| warning.code == "worktree_dirty"));
    assert_eq!(report.affected_total, 1);

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(local, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "local-b"
    );
    assert_eq!(
        git_ok(local, &["config", "branch.local-b.merge"]).trim(),
        "refs/heads/feat-b"
    );
    assert_eq!(
        std::fs::read_to_string(local.join("a.txt")).expect("读取文件"),
        "base\nlocal\n"
    );
}

#[test]
fn checkout_remote_branch_gate_rejections() {
    let sandbox = remote_sandbox("write-remote-checkout-reject");
    let (source, local) = (sandbox.source(), sandbox.local());
    git_ok(source, &["branch", "feat-a"]);
    git_ok(source, &["push", "origin", "feat-a"]);
    git_ok(local, &["fetch", "origin"]);
    git_ok(local, &["branch", "feat-a"]);

    let module = GitWriteModule::new(local).expect("打开写模块");
    // 目标本地分支已存在。
    let report = module
        .validate(&branch_request(
            WriteKind::CheckoutRemoteBranch,
            "origin/feat-a",
        ))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_branch_exists"),
        "{report:?}"
    );

    // 本地没有该远程跟踪引用（未 fetch）。
    let report = module
        .validate(&branch_request(
            WriteKind::CheckoutRemoteBranch,
            "origin/nope",
        ))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_remote_ref_missing"),
        "{report:?}"
    );

    // 选项注入形态与缺少 remote 前缀均拒绝。
    for invalid in ["-bad", "no-remote-prefix"] {
        let report = module
            .validate(&branch_request(WriteKind::CheckoutRemoteBranch, invalid))
            .expect("Gate");
        assert!(
            issue_codes(&report).contains(&"gate_invalid_remote_branch"),
            "{invalid}: {report:?}"
        );
    }
}

#[test]
fn push_without_upstream_reports_configured_remote_without_tracking_refs() {
    let dir = temp_dir("write-remote-push-gate-origin");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库");
    git_ok(&repo, &["init", "-q", "-b", "main"]);
    configure_repo(&repo);
    commit(&repo, "a.txt", "base\n", "c1");
    git_ok(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            dir.join("remote.git").to_string_lossy().as_ref(),
        ],
    );
    let module = GitWriteModule::new(&repo).expect("打开写模块");

    let report = module
        .validate(&base_request(WriteKind::Push))
        .expect("Gate");
    assert!(!report.ok);
    let issue = report
        .issues
        .iter()
        .find(|issue| issue.code == "gate_remote_no_upstream")
        .expect("缺少上游");
    assert_eq!(
        issue
            .args
            .as_ref()
            .and_then(|args| args.get("remote"))
            .map(String::as_str),
        Some("origin")
    );
    assert!(!ref_exists(&repo, "refs/remotes/origin/main"));
}

#[test]
fn push_set_upstream_establishes_tracking() {
    let sandbox = remote_sandbox("write-remote-push-upstream");
    let (local, remote) = (sandbox.local(), sandbox.remote());
    git_ok(local, &["switch", "-c", "feat-new"]);
    let head = commit(local, "feat.txt", "feat\n", "feat 提交");

    let module = GitWriteModule::new(local).expect("打开写模块");
    let request = branch_request(WriteKind::PushSetUpstream, "feat-new");
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert_eq!(
        report.summary_key.as_deref(),
        Some("errors.gateSummaryPushSetUpstream")
    );
    assert_eq!(
        report
            .summary_args
            .as_ref()
            .and_then(|args| args.get("remote"))
            .map(String::as_str),
        Some("origin")
    );

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        outcome.key.as_deref(),
        Some("errors.outcomePushUpstreamSet")
    );
    assert_eq!(
        git_ok(local, &["config", "branch.feat-new.remote"]).trim(),
        "origin"
    );
    assert_eq!(
        git_ok(local, &["config", "branch.feat-new.merge"]).trim(),
        "refs/heads/feat-new"
    );
    assert_eq!(
        git_ok(remote, &["rev-parse", "refs/heads/feat-new"]).trim(),
        head
    );
}

#[test]
fn push_set_upstream_gate_rejections() {
    let sandbox = remote_sandbox("write-remote-push-upstream-reject");
    let local = sandbox.local();
    git_ok(local, &["branch", "topic"]);
    let module = GitWriteModule::new(local).expect("打开写模块");

    // 当前分支已有上游。
    let report = module
        .validate(&branch_request(WriteKind::PushSetUpstream, "main"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_push_upstream_exists"),
        "{report:?}"
    );

    // 非当前检出的分支。
    let report = module
        .validate(&branch_request(WriteKind::PushSetUpstream, "topic"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_push_branch_not_current"),
        "{report:?}"
    );

    // 显式指定未配置的 remote。
    let request = WriteRequest {
        branch: Some("main".to_owned()),
        remote: Some("nope".to_owned()),
        ..base_request(WriteKind::PushSetUpstream)
    };
    let report = module.validate(&request).expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_remote_unknown"),
        "{report:?}"
    );

    // 完全没有 remote 的仓库。
    let temp = init_temp_repo();
    commit(temp.path(), "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");
    let report = module
        .validate(&branch_request(WriteKind::PushSetUpstream, "main"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_remote_missing"),
        "{report:?}"
    );
}

#[test]
fn push_set_upstream_requires_explicit_remote_when_ambiguous() {
    let dir = temp_dir("write-remote-ambiguous");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库");
    git_ok(&repo, &["init", "-q", "-b", "main"]);
    configure_repo(&repo);
    commit(&repo, "a.txt", "base\n", "c1");
    for name in ["alpha", "beta"] {
        let bare = dir.join(format!("{name}.git"));
        std::fs::create_dir_all(&bare).expect("创建 bare");
        git_ok(&bare, &["init", "--bare", "-b", "main"]);
        let bare_str = bare.to_string_lossy().into_owned();
        git_ok(&repo, &["remote", "add", name, &bare_str]);
    }

    let module = GitWriteModule::new(&repo).expect("打开写模块");
    let report = module
        .validate(&branch_request(WriteKind::PushSetUpstream, "main"))
        .expect("Gate");
    assert!(!report.ok);
    assert!(
        issue_codes(&report).contains(&"gate_remote_ambiguous"),
        "{report:?}"
    );
    let options = report
        .issues
        .iter()
        .find(|issue| issue.code == "gate_remote_ambiguous")
        .and_then(|issue| issue.args.as_ref())
        .and_then(|args| args.get("options"))
        .cloned()
        .unwrap_or_default();
    assert!(
        options.contains("alpha") && options.contains("beta"),
        "{options}"
    );

    // 显式指定后放行，并推送到该 remote。
    let request = WriteRequest {
        branch: Some("main".to_owned()),
        remote: Some("beta".to_owned()),
        ..base_request(WriteKind::PushSetUpstream)
    };
    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let beta = dir.join("beta.git");
    assert!(ref_exists(&beta, "refs/heads/main"));
    assert!(!ref_exists(&dir.join("alpha.git"), "refs/heads/main"));
}

#[test]
fn fetch_prune_removes_deleted_remote_tracking_ref() {
    let sandbox = remote_sandbox("write-remote-prune");
    let (source, local) = (sandbox.source(), sandbox.local());
    git_ok(source, &["branch", "topic"]);
    git_ok(source, &["push", "origin", "topic"]);
    git_ok(local, &["fetch", "origin"]);
    assert!(ref_exists(local, "refs/remotes/origin/topic"));

    git_ok(source, &["push", "origin", "--delete", "topic"]);
    let module = GitWriteModule::new(local).expect("打开写模块");
    let request = base_request(WriteKind::FetchPrune);
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert_eq!(
        report.summary_key.as_deref(),
        Some("errors.gateSummaryFetchPrune")
    );

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeFetchPruned"));
    assert!(!ref_exists(local, "refs/remotes/origin/topic"));
}

#[test]
fn push_tag_creates_tag_on_remote() {
    let sandbox = remote_sandbox("write-remote-tag");
    let (local, remote) = (sandbox.local(), sandbox.remote());
    git_ok(local, &["tag", "-a", "v1.0.0", "-m", "release"]);
    let tag_oid = git_ok(local, &["rev-parse", "v1.0.0"]).trim().to_owned();

    let module = GitWriteModule::new(local).expect("打开写模块");
    let request = branch_request(WriteKind::PushTag, "v1.0.0");
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert_eq!(
        report.summary_key.as_deref(),
        Some("errors.gateSummaryTagPush")
    );

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeTagPushed"));
    assert_eq!(
        git_ok(remote, &["rev-parse", "refs/tags/v1.0.0"]).trim(),
        tag_oid
    );
}

#[test]
fn push_tag_gate_rejections() {
    let sandbox = remote_sandbox("write-remote-tag-reject");
    let local = sandbox.local();
    let module = GitWriteModule::new(local).expect("打开写模块");

    // 本地标签不存在。
    let report = module
        .validate(&branch_request(WriteKind::PushTag, "v9.9.9"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_tag_missing"),
        "{report:?}"
    );

    // 选项注入形态。
    let report = module
        .validate(&branch_request(WriteKind::PushTag, "-v1"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_invalid_tag_name"),
        "{report:?}"
    );

    // 无 remote。
    let temp = init_temp_repo();
    commit(temp.path(), "a.txt", "base\n", "c1");
    git_ok(temp.path(), &["tag", "v1"]);
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");
    let report = module
        .validate(&branch_request(WriteKind::PushTag, "v1"))
        .expect("Gate");
    assert!(
        issue_codes(&report).contains(&"gate_remote_missing"),
        "{report:?}"
    );
}
