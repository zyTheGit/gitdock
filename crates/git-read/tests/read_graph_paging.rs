//! 图谱分页、cursor 不透明性与索引缓存复用。

mod common;

use std::collections::HashSet;
use std::path::PathBuf;

use common::*;
use git_core::{ErrorCode, GraphScope, Oid};
use git_read::GitReadModule;
use test_support::{copy_dir, fixtures, git_ok, oid_of, read_oid, temp_dir};

#[test]
fn cursor_is_opaque_and_lanes_stable_across_pages() {
    let set = fixtures();
    let read = module(&set.linear());

    let mut seen = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page = read
            .read_graph_page(&GraphScope::Head, cursor.as_deref(), 2)
            .expect("分页读取");
        assert_eq!(page.layout.len(), page.commits.len());
        for (commit, row) in page.commits.iter().zip(&page.layout) {
            assert_eq!(commit.oid, row.oid);
            seen.push((commit.oid.clone(), row.lane));
        }
        match page.next_cursor {
            Some(token) => {
                assert!(!token.contains("offset"), "游标不得暴露 offset: {token}");
                assert!(!token.contains("index"), "游标不得暴露 index: {token}");
                cursor = Some(token);
            }
            None => break,
        }
    }
    assert_eq!(seen.len(), 6);
    let unique: HashSet<&Oid> = seen.iter().map(|(oid, _)| oid).collect();
    assert_eq!(unique.len(), 6, "分页不得重复提交");

    // 重新以整页读取，历史行的 lane 必须与分页时一致。
    let whole = read
        .read_graph_page(&GraphScope::Head, None, 200)
        .expect("整页读取");
    for (oid, lane) in seen {
        let row = whole
            .layout
            .iter()
            .find(|row| row.oid == oid)
            .expect("历史提交仍在布局中");
        assert_eq!(row.lane, lane, "同一 view_key 内 lane 必须稳定: {oid}");
    }
}

#[test]
fn fork_pagination_resolves_cross_page_edge() {
    let set = fixtures();
    let read = module(&set.forked());

    let first = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("第一页");
    assert_eq!(first.layout.len(), 2);
    assert_eq!(first.commits.len(), 2);

    let second = read
        .read_graph_page(&GraphScope::All, first.next_cursor.as_deref(), 20)
        .expect("第二页");

    // 第一页的 pending 父边必须在第二页的 resolved 通知中出现。
    for row in &first.layout {
        for edge in row.parents.iter().filter(|edge| edge.pending) {
            assert!(
                second
                    .resolved_edges
                    .iter()
                    .any(|resolved| resolved.parent == edge.parent),
                "缺少跨页解析通知: {}",
                edge.parent
            );
        }
    }

    // 重新读取第一页：内部布局已被 resolved 通知更新。
    let first_again = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("重读第一页");
    for row in first_again.layout.iter().chain(&second.layout) {
        for edge in &row.parents {
            assert!(!edge.pending, "父边仍 pending: {}", edge.parent);
        }
    }
    // 第一页已渲染行的 lane 不应被第二页改写。
    for row in &first.layout {
        let again = first_again
            .layout
            .iter()
            .find(|r| r.oid == row.oid)
            .expect("提交存在");
        assert_eq!(again.lane, row.lane);
    }
}

#[test]
fn around_anchor_returns_page_containing_commit() {
    let set = fixtures();
    let read = module(&set.linear());
    let anchor = oid_of(&read_oid(&set.linear(), "HEAD~3"));
    let page = read
        .read_graph_page_around(&GraphScope::Head, &anchor, 2)
        .expect("定位读取");
    assert!(
        page.commits.iter().any(|c| c.oid == anchor),
        "定位页必须包含锚点提交"
    );
}

#[test]
fn stale_cursor_is_rejected_after_ref_change() {
    let set = fixtures();
    let dir = temp_dir("git-graph-read-stale");
    let repo = dir.join("linear");
    copy_dir(&set.linear(), &repo);

    let read = module(&repo);
    let page = read
        .read_graph_page(&GraphScope::Head, None, 2)
        .expect("第一页");
    let cursor = page.next_cursor.expect("还有下一页");
    let generation = page.generation;

    git_ok(&repo, &["update-ref", "refs/heads/extra", "HEAD"]);
    assert_ne!(
        read.current_generation().expect("新 generation"),
        generation,
        "refs 变化必须产生新 generation"
    );

    let err = read
        .read_graph_page(&GraphScope::Head, Some(&cursor), 2)
        .expect_err("旧游标必须失效");
    assert_eq!(err.code, ErrorCode::CursorStale);
}

#[test]
fn index_cache_is_reused_between_reads() {
    let set = fixtures();
    let cache = temp_dir("git-graph-read-cache");
    let read = GitReadModule::open(&set.linear(), Some(cache.clone())).expect("带缓存目录打开仓库");

    let first = read
        .read_graph_page(&GraphScope::Head, None, 3)
        .expect("首次读取");
    let cached: Vec<PathBuf> = std::fs::read_dir(&cache)
        .expect("读取缓存目录")
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("json"))
        .collect();
    assert!(!cached.is_empty(), "拓扑索引应写入缓存");

    let second = read
        .read_graph_page(&GraphScope::Head, None, 3)
        .expect("二次读取");
    assert_eq!(first.generation, second.generation);
    let first_lanes: Vec<(Oid, usize)> = first
        .layout
        .iter()
        .map(|row| (row.oid.clone(), row.lane))
        .collect();
    let second_lanes: Vec<(Oid, usize)> = second
        .layout
        .iter()
        .map(|row| (row.oid.clone(), row.lane))
        .collect();
    assert_eq!(first_lanes, second_lanes);
}
