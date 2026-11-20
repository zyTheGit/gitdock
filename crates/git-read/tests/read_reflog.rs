//! `HEAD` reflog 只读读取（ADR-0029）：顺序、序号与条数上限。

mod common;

use common::*;
use git_read::{DEFAULT_REFLOG_LIMIT, MAX_REFLOG_LIMIT};
use test_support::{commit, current_head, git_ok, init_repo, init_temp_repo, temp_dir};

#[test]
fn reflog_reads_head_newest_first() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let first = current_head(dir);
    commit(dir, "a.txt", "two\n", "c2");
    let second = current_head(dir);

    let read = module(dir);
    let entries = read.read_reflog(DEFAULT_REFLOG_LIMIT).expect("读取 reflog");
    // 每次提交写一条 HEAD reflog；最新在前，序号与 `HEAD@{N}` 对齐。
    assert_eq!(entries.len(), 2, "{entries:?}");
    assert_eq!(entries[0].index, 0);
    assert_eq!(entries[0].selector, "HEAD@{0}");
    assert_eq!(entries[0].new_oid.as_str(), second);
    assert_eq!(entries[1].selector, "HEAD@{1}");
    assert_eq!(entries[1].new_oid.as_str(), first);
    assert_eq!(
        entries[0].old_oid.as_ref().map(|oid| oid.as_str()),
        Some(first.as_str())
    );
    assert!(entries[0].message.contains("commit"), "{entries:?}");
    assert!(entries.iter().all(|entry| entry.created_at > 0));
}

#[test]
fn reflog_cap_keeps_newest_entries() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    commit(dir, "a.txt", "three\n", "c3");
    let head = current_head(dir);

    let read = module(dir);
    let entries = read.read_reflog(2).expect("读取 reflog");
    assert_eq!(entries.len(), 2, "{entries:?}");
    assert_eq!(entries[0].new_oid.as_str(), head);
    assert_eq!(entries[0].selector, "HEAD@{0}");
    assert_eq!(entries[1].selector, "HEAD@{1}");

    // 上限被钳制，不会把整份 reflog 塞进 IPC。
    let clamped = read.read_reflog(usize::MAX).expect("读取 reflog");
    assert!(clamped.len() <= MAX_REFLOG_LIMIT);
    assert!(clamped.len() >= 2);
}

#[test]
fn reflog_of_repository_without_log_is_empty() {
    // 关掉 reflog 写入：仓库可正常打开，但没有任何可恢复记录。
    let dir = temp_dir("git-graph-read-reflog-empty");
    init_repo(&dir);
    git_ok(&dir, &["config", "core.logAllRefUpdates", "false"]);
    commit(&dir, "a.txt", "one\n", "c1");

    let read = module(&dir);
    let entries = read.read_reflog(DEFAULT_REFLOG_LIMIT).expect("读取 reflog");
    assert!(entries.is_empty(), "{entries:?}");
}
