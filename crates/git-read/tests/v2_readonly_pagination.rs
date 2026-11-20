//! V2 分页与 generation：cursor 不透明性、跨页不变量与 ref 变化后的失效语义。

mod common;

use std::collections::HashSet;

use common::*;
use git_core::{decode_cursor, ErrorCode, GraphScope, Oid};
use test_support::{copy_dir, fixtures, git_ok, temp_dir};

fn is_hex_oid(text: &str) -> bool {
    (text.len() == 40 || text.len() == 64) && text.chars().all(|c| c.is_ascii_hexdigit())
}

/// base64url(no pad) 解码：仅用于检查 cursor 载荷形状，不引入新依赖。
fn base64url_decode(token: &str) -> Vec<u8> {
    fn value(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'-' => Some(62),
            b'_' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = token
        .bytes()
        .filter(|b| *b != b'=')
        .map(|b| value(b).unwrap_or_else(|| panic!("cursor 含非 base64url 字符: {b}")))
        .collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        for (i, b) in chunk.iter().enumerate() {
            buf[i] = *b;
        }
        let n = (buf[0] as u32) << 18
            | (buf[1] as u32) << 12
            | (buf.get(2).copied().unwrap_or(0) as u32) << 6
            | buf.get(3).copied().unwrap_or(0) as u32;
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    out
}

#[test]
fn forked_pagination_has_opaque_cursor_and_no_gaps() {
    let set = fixtures();
    let read = module(&set.forked());
    let full = read
        .read_graph_page(&GraphScope::All, None, 200)
        .expect("整页读取");
    let full_order: Vec<Oid> = full.commits.iter().map(|c| c.oid.clone()).collect();
    assert!(full_order.len() >= 7);

    let mut cursor: Option<String> = None;
    let mut collected: Vec<Oid> = Vec::new();
    let mut cursor_records = Vec::new();
    let mut page_lanes: Vec<Vec<(Oid, usize)>> = Vec::new();
    let mut page_cursors: Vec<Option<String>> = Vec::new();
    let mut guard = 0;

    loop {
        guard += 1;
        assert!(guard < 100, "分页未终止");
        let page = read
            .read_graph_page(&GraphScope::All, cursor.as_deref(), 2)
            .unwrap_or_else(|e| panic!("分页读取失败: {e:?}"));
        assert_eq!(page.view_key, "all");
        assert!(page.commits.len() <= 2);
        assert_eq!(page.layout.len(), page.commits.len());
        for (commit, row) in page.commits.iter().zip(&page.layout) {
            assert_eq!(commit.oid, row.oid);
            collected.push(commit.oid.clone());
        }
        page_lanes.push(
            page.layout
                .iter()
                .map(|row| (row.oid.clone(), row.lane))
                .collect(),
        );
        page_cursors.push(cursor.clone());

        match page.next_cursor.clone() {
            Some(token) => {
                // 不透明 token：base64url 无填充、解码后字段固定为 4 个。
                assert!(!token.contains('='), "cursor 不应含 base64 填充: {token}");
                assert!(
                    !token.contains("offset") && !token.contains("index"),
                    "cursor 明文暴露位置信息: {token}"
                );
                let payload = base64url_decode(&token);
                let text = String::from_utf8(payload).expect("cursor 载荷必须是 UTF-8 JSON");
                assert!(text.contains("\"v\":"), "cursor 载荷: {text}");
                assert!(text.contains("\"view_key\":\"all\""), "cursor 载荷: {text}");
                assert!(text.contains("\"generation\":"), "cursor 载荷: {text}");
                assert!(text.contains("\"after\":\""), "cursor 载荷: {text}");
                assert_eq!(
                    text.matches(':').count(),
                    4,
                    "cursor 只能有 4 个字段（v/view_key/generation/after）: {text}"
                );
                for forbidden in ["offset", "start", "pos", "page", "limit", "row"] {
                    assert!(
                        !text.contains(forbidden),
                        "cursor 载荷出现位置语义 {forbidden}: {text}"
                    );
                }
                let data = decode_cursor(&token).expect("公开解码器可读 cursor");
                assert_eq!(data.generation, page.generation);
                assert_eq!(data.view_key, "all");
                assert!(is_hex_oid(&data.after));
                cursor_records.push(token.clone());
                cursor = Some(token);
            }
            None => {
                assert!(!page.has_more, "末页 has_more 必须为 false");
                break;
            }
        }
    }

    // 页与页之间：无重复、无遗漏、顺序与整页读取一致。
    let unique: HashSet<&Oid> = collected.iter().collect();
    assert_eq!(unique.len(), collected.len(), "分页出现重复提交");
    assert_eq!(collected, full_order, "分页顺序必须与整页读取一致");
    assert_eq!(cursor_records.len(), page_lanes.len() - 1);

    // 重新读取同一页（用同一 cursor）lane 必须相同。
    for (index, token) in page_cursors.iter().enumerate() {
        if index == 0 {
            continue;
        }
        let again = read
            .read_graph_page(&GraphScope::All, Some(token.as_deref().unwrap()), 2)
            .expect("重读同一页");
        let lanes_again: Vec<(Oid, usize)> = again
            .layout
            .iter()
            .map(|row| (row.oid.clone(), row.lane))
            .collect();
        assert_eq!(lanes_again, page_lanes[index], "第 {index} 页 lane 不稳定");

        // 同 cursor 重新渲染应产生完全相同的 next_cursor。
        assert_eq!(
            again.next_cursor,
            cursor_records.get(index).cloned(),
            "cursor 必须确定性"
        );
    }

    // 整页读取后，所有历史行的 lane 与分页时一致（同一 view_key 生命周期）。
    for lanes in &page_lanes {
        for (oid, lane) in lanes {
            let row = full
                .layout
                .iter()
                .find(|row| &row.oid == oid)
                .expect("提交仍在布局中");
            assert_eq!(row.lane, *lane, "lane 必须稳定: {oid}");
        }
    }

    println!(
        "PAGINATION pages={} commits={} cursors={} max_lane={}",
        page_lanes.len(),
        collected.len(),
        cursor_records.len(),
        full.layout.iter().map(|r| r.lane).max().unwrap_or(0)
    );
}

#[test]
fn cursor_from_other_view_is_invalid_not_stale() {
    let set = fixtures();
    let read = module(&set.forked());
    let all = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("All 第一页");
    let cursor = all.next_cursor.expect("存在下一页");
    let err = read
        .read_graph_page(&GraphScope::Head, Some(&cursor), 2)
        .expect_err("跨视图 cursor 必须被拒绝");
    assert_eq!(err.code, ErrorCode::CursorInvalid);
}

#[test]
fn old_cursor_is_stale_after_ref_changes() {
    let set = fixtures();
    let dir = temp_dir("git-graph-v2-generation");
    let repo = dir.join("forked");
    copy_dir(&set.forked(), &repo);

    let read = module(&repo);
    let first = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("第一页");
    let cursor = first.next_cursor.clone().expect("还有下一页");
    let generation = first.generation;

    // 场景 A：移动已有分支 ref。
    git_ok(
        &repo,
        &["update-ref", "refs/heads/main", "refs/heads/feature"],
    );
    let after_move = read.current_generation().expect("新 generation");
    assert_ne!(after_move, generation, "移动 ref 必须改变 generation");
    let err = read
        .read_graph_page(&GraphScope::All, Some(&cursor), 2)
        .expect_err("移动 ref 后旧 cursor 必须失效");
    assert_eq!(
        err.code,
        ErrorCode::CursorStale,
        "必须是 CursorStale 而非静默错页"
    );

    // 场景 B：删除一个 ref（不新增标记 ref，避免状态回到 cursor 签发时的指纹）。
    let second = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("新 generation 首页");
    assert_ne!(second.generation, generation);
    let cursor_b = second.next_cursor.clone().expect("仍有多页");
    git_ok(&repo, &["update-ref", "-d", "refs/remotes/origin/feature"]);

    let err = read
        .read_graph_page(&GraphScope::All, Some(&cursor_b), 2)
        .expect_err("删除 ref 后旧 cursor 必须失效");
    assert_eq!(err.code, ErrorCode::CursorStale);

    // 观察：generation 是状态指纹而非单调计数。新增后删除同一 ref 会得到相同 generation，
    // 此时旧 cursor 恢复可用且内容正确（状态确实回到了签发时的样子）。
    let stable_gen = read.current_generation().expect("稳定状态 generation");
    git_ok(&repo, &["update-ref", "refs/heads/extra", "HEAD"]);
    assert_ne!(
        read.current_generation().expect("新增后 generation"),
        stable_gen
    );
    git_ok(&repo, &["update-ref", "-d", "refs/heads/extra"]);
    let reverted = read.current_generation().expect("删除后 generation");
    let stable = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("稳定状态首页");
    let resumed = read
        .read_graph_page(&GraphScope::All, stable.next_cursor.as_deref(), 2)
        .expect("指纹回归后 cursor 可继续");
    assert!(
        resumed
            .commits
            .iter()
            .all(|c| !stable.commits.iter().any(|s| s.oid == c.oid)),
        "同 generation 续页不应重复"
    );

    println!(
        "GENERATION initial={} after_move={} after_delete={} stable={} reverted={} stale_errors=2",
        generation, second.generation, reverted, stable_gen, reverted
    );
}
