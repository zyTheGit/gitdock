//! 本地分支上游与 ahead/behind 只读计数（ADR-0028）。
//!
//! 夹具用本地 bare 仓库充当 remote：`git clone` 后 `git fetch` 更新 `refs/remotes/origin/*`，
//! 不访问网络。

mod common;

use std::path::Path;

use common::*;
use git_core::RefKind;
use test_support::{commit, git_ok, init_repo, init_temp_repo, temp_dir};

/// clone 出来的仓库不带 user 配置，这里补齐并屏蔽本机全局配置。
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

/// 建立 bare remote + 从它 clone 的本地仓库；返回 (临时目录, local, remote)。
fn create_remote_and_clone(
    prefix: &str,
) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let dir = temp_dir(prefix);
    let source = dir.join("source");
    std::fs::create_dir_all(&source).expect("创建 source");
    init_repo(&source);
    commit(&source, "a.txt", "base\n", "c1");

    let remote = dir.join("remote.git");
    std::fs::create_dir_all(&remote).expect("创建 bare remote");
    git_ok(&remote, &["init", "--bare", "-b", "main"]);
    let remote_str = remote.to_string_lossy().into_owned();
    git_ok(&source, &["remote", "add", "origin", &remote_str]);
    git_ok(&source, &["push", "-u", "origin", "main"]);

    let local = dir.join("local");
    git_ok(
        &dir,
        &["-c", "core.autocrlf=false", "clone", &remote_str, "local"],
    );
    configure(&local);
    (dir, local, remote)
}

#[test]
fn local_branch_reports_upstream_ahead_and_behind() {
    let (dir, local, _remote) = create_remote_and_clone("git-graph-read-upstream");
    // 本地领先 2 个提交。
    commit(&local, "local1.txt", "l1\n", "local 1");
    commit(&local, "local2.txt", "l2\n", "local 2");
    // 远端另有 1 个提交，本地 fetch 后落后 1。
    let source = dir.join("source");
    commit(&source, "remote1.txt", "r1\n", "remote 1");
    git_ok(&source, &["push", "origin", "main"]);
    git_ok(&local, &["fetch", "origin"]);

    let read = module(&local);
    let state = read.state().expect("读取状态");
    let main = state
        .refs
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .expect("本地分支 main");
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    assert_eq!(main.ahead, Some(2));
    assert_eq!(main.behind, Some(1));

    // 远程跟踪分支本身不带上游计数。
    let remote_ref = state
        .refs
        .iter()
        .find(|r| r.short_name == "origin/main")
        .expect("远程跟踪分支");
    assert_eq!(remote_ref.kind, RefKind::RemoteBranch);
    assert!(remote_ref.upstream.is_none());
    assert!(remote_ref.ahead.is_none());
    assert!(remote_ref.behind.is_none());
}

#[test]
fn branch_without_upstream_has_no_counts() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["branch", "topic"]);

    let read = module(dir);
    let state = read.state().expect("读取状态");
    let topic = state
        .refs
        .iter()
        .find(|r| r.short_name == "topic")
        .expect("本地分支 topic");
    assert!(topic.upstream.is_none());
    assert!(topic.ahead.is_none());
    assert!(topic.behind.is_none());
}

#[test]
fn configured_upstream_without_tracking_ref_reports_name_only() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    git_ok(dir, &["branch", "topic"]);
    // 配置了上游，但本地没有对应的 refs/remotes/origin/topic（未 fetch 或远端已删）。
    git_ok(dir, &["config", "branch.topic.remote", "origin"]);
    git_ok(dir, &["config", "branch.topic.merge", "refs/heads/topic"]);

    let read = module(dir);
    let state = read.state().expect("读取状态");
    let topic = state
        .refs
        .iter()
        .find(|r| r.short_name == "topic")
        .expect("本地分支 topic");
    assert_eq!(topic.upstream.as_deref(), Some("origin/topic"));
    assert!(topic.ahead.is_none());
    assert!(topic.behind.is_none());
}
