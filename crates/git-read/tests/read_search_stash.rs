//! 搜索（信息 / 作者 / 路径 / hash 前缀）与 stash 列表读取。

mod common;

use common::*;
use git_core::{GraphScope, SearchField, SearchRequest};
use test_support::{commit, current_head, fixtures, git_ok, init_temp_repo, write};

#[test]
fn search_matches_message_author_and_path() {
    let set = fixtures();
    let read = module(&set.forked());

    let request = |id: &str, text: &str| SearchRequest {
        search_id: id.to_owned(),
        scope: GraphScope::All,
        text: text.to_owned(),
        highlight: text.to_owned(),
    };

    let message = read
        .search(&request("s1", "merge feature"), None)
        .expect("按信息搜索");
    assert_eq!(message.results.len(), 1);
    assert!(message.results[0].fields.contains(&SearchField::Message));
    assert!(!message.has_more);

    let author = read
        .search(&request("s2", "fixture@example.com"), None)
        .expect("按作者搜索");
    assert_eq!(author.results.len(), 7);
    assert!(author
        .results
        .iter()
        .all(|r| r.fields.contains(&SearchField::Author)));

    let path = read
        .search(&request("s3", "feature.txt"), None)
        .expect("按路径搜索");
    assert!(path
        .results
        .iter()
        .any(|r| r.matched_path.as_deref() == Some("feature.txt")));

    let empty = read.search(&request("s4", "   "), None).expect("空查询");
    assert!(empty.results.is_empty());
    assert!(!empty.has_more);

    // 取消接口对不存在的搜索是安全空操作。
    read.cancel_search("unknown-search");
}

#[test]
fn hash_search_requires_seven_char_prefix() {
    let set = fixtures();
    let repo = set.forked();
    let read = module(&repo);
    let head = current_head(&repo);

    let request = |id: &str, text: &str| SearchRequest {
        search_id: id.to_owned(),
        scope: GraphScope::All,
        text: text.to_owned(),
        highlight: text.to_owned(),
    };

    // 不足 7 位的十六进制串不得按 hash 命中。
    let short = read
        .search(&request("h1", &head[..6]), None)
        .expect("短前缀搜索");
    assert!(short
        .results
        .iter()
        .all(|result| !result.fields.contains(&SearchField::Hash)));

    let long = read
        .search(&request("h2", &head[..7]), None)
        .expect("7 位前缀搜索");
    assert!(long.results.iter().any(|result| {
        result.commit.oid.as_str() == head && result.fields.contains(&SearchField::Hash)
    }));
}

#[test]
fn stash_list_reads_reflog_newest_first() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    write(&dir.join("a.txt"), "first\n");
    git_ok(dir, &["stash", "push", "-m", "first"]);
    write(&dir.join("a.txt"), "second\n");
    git_ok(dir, &["stash", "push", "-m", "second"]);

    let read = module(dir);
    let stashes = read.read_stashes().expect("读取 stash");
    assert_eq!(stashes.len(), 2);
    assert_eq!(stashes[0].selector, "stash@{0}");
    assert_eq!(stashes[0].message, "On main: second");
    assert_eq!(stashes[1].message, "On main: first");
    assert_eq!(
        stashes[0].oid.as_str(),
        git_ok(dir, &["rev-parse", "stash@{0}"])
    );
}
