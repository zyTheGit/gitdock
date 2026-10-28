//! 阶段 0 · V2 准入验证：gix 只读链路与 OID 格式兼容性。
//!
//! 覆盖：六类夹具打开、cursor 不透明性与分页不变量、generation 失效、
//! SHA-256 annotated tag / commit 详情 / compare、只读性静态与运行时快照、
//! 200 行分页的 open + 首页耗时（含索引缓存命中）。

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use git_core::{
    decode_cursor, CompareMode, DiffBaselineDto, ErrorCode, FileStatus, GraphScope, HeadKind,
    ObjectFormat, Oid, RefKind,
};
use git_read::GitReadModule;
use test_support::{fixtures, git_ok, read_oid};

/* ------------------------------ 工具 ------------------------------ */

fn module(path: &Path) -> GitReadModule {
    GitReadModule::open(path, None).expect("打开夹具仓库")
}

fn oid_of(text: &str) -> Oid {
    Oid::new(text).expect("合法 OID")
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-graph-v2-{}-{}", name, std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).expect("清理旧临时目录");
    }
    std::fs::create_dir_all(&dir).expect("创建临时目录");
    dir
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("创建目标目录");
    for entry in std::fs::read_dir(from).expect("读取源目录") {
        let entry = entry.expect("目录项");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("文件类型").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("复制文件");
        }
    }
}

/// 断言 OID 长度与仓库对象格式一致，绝不假设固定 40 位。
fn assert_oid_len(oid: &Oid, format: ObjectFormat, what: &str) {
    assert_eq!(
        oid.len(),
        format.hex_len(),
        "{what} 长度必须等于 {}（实际 {}）",
        format.hex_len(),
        oid.len()
    );
    assert!(
        oid.as_str().chars().all(|c| c.is_ascii_hexdigit()),
        "{what} 必须是十六进制"
    );
}

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

fn median_ms(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

/* ------------------------------ 1. 六类夹具 ------------------------------ */

#[test]
fn six_fixture_kinds_open_with_format_aware_oids() {
    let set = fixtures();
    struct Case {
        name: &'static str,
        path: PathBuf,
        format: ObjectFormat,
        bare: bool,
        shallow: bool,
        linked: bool,
    }
    let cases = vec![
        Case {
            name: "linear",
            path: set.linear(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "forked",
            path: set.forked(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "sha256",
            path: set.sha256(),
            format: ObjectFormat::Sha256,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "shallow",
            path: set.shallow(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: true,
            linked: false,
        },
        Case {
            name: "bare",
            path: set.bare(),
            format: ObjectFormat::Sha1,
            bare: true,
            shallow: false,
            linked: false,
        },
        Case {
            name: "worktree-linked",
            path: set.worktree_linked(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: true,
        },
    ];

    for case in cases {
        let read = module(&case.path);
        assert_eq!(read.object_format(), case.format, "{} 对象格式", case.name);
        let state = read.state().unwrap_or_else(|e| panic!("{} 读取状态: {e:?}", case.name));
        assert_eq!(state.object_format, case.format, "{}", case.name);
        assert_eq!(state.is_bare, case.bare, "{} is_bare", case.name);
        assert_eq!(state.is_shallow, case.shallow, "{} is_shallow", case.name);
        assert_eq!(
            state.is_linked_worktree, case.linked,
            "{} is_linked_worktree",
            case.name
        );

        // HeadDto：分支名与 OID 必须按对象格式编码。
        assert!(
            matches!(state.head.kind, HeadKind::Branch | HeadKind::Detached),
            "{} HEAD 应有 OID",
            case.name
        );
        let head = state.head.oid.clone().expect("HEAD OID 存在");
        assert_oid_len(&head, case.format, &format!("{} HEAD", case.name));
        if !case.bare {
            assert!(state.head.branch.is_some(), "{} HEAD 应关联分支", case.name);
        }

        // refs 中所有 OID（tag 对象与 peel 后 commit）都需符合格式。
        for reference in &state.refs {
            assert_oid_len(
                &reference.target_oid,
                case.format,
                &format!("{} ref {}", case.name, reference.full_name),
            );
            if let Some(commit) = &reference.commit_oid {
                assert_oid_len(
                    commit,
                    case.format,
                    &format!("{} ref peel {}", case.name, reference.full_name),
                );
            }
        }

        let page = read
            .read_graph_page(&GraphScope::Head, None, 200)
            .unwrap_or_else(|e| panic!("{} 读取图谱: {e:?}", case.name));
        assert!(!page.commits.is_empty(), "{} 图谱不应为空", case.name);
        assert_eq!(page.layout.len(), page.commits.len(), "{} 行数对齐", case.name);
        for commit in &page.commits {
            assert_oid_len(&commit.oid, case.format, "commit.oid");
            assert!(
                commit
                    .short_oid
                    .chars()
                    .all(|c| c.is_ascii_hexdigit()),
                "{} short_oid 必须是十六进制: {}",
                case.name,
                commit.short_oid
            );
            assert_eq!(commit.short_oid.len(), 7, "{} short_oid 长度", case.name);
            assert!(
                commit.oid.as_str().starts_with(&commit.short_oid),
                "{} short_oid 必须是完整 OID 前缀",
                case.name
            );
            for parent in &commit.parents {
                assert_oid_len(parent, case.format, "commit.parent");
            }
        }
        for row in &page.layout {
            assert_oid_len(&row.oid, case.format, "row.oid");
            for lane in row.before_lanes.iter().chain(&row.after_lanes) {
                if let Some(oid) = lane {
                    assert_oid_len(oid, case.format, "lane 期待 OID");
                }
            }
            for edge in &row.parents {
                assert_oid_len(&edge.parent, case.format, "parent edge OID");
            }
        }
        for edge in &page.resolved_edges {
            assert_oid_len(&edge.parent, case.format, "resolved edge OID");
        }

        // 同一仓库用模块内 HEAD 视图也要可读（bare 也应有 HEAD）。
        assert!(
            page.commits.iter().any(|c| c.oid == head),
            "{} HEAD 视图应包含 HEAD",
            case.name
        );

        println!(
            "FIXTURE {} format={:?} head={} head_len={} branch={:?} bare={} shallow={} linked={} commits={}",
            case.name,
            case.format,
            head,
            head.len(),
            state.head.branch,
            state.is_bare,
            state.is_shallow,
            state.is_linked_worktree,
            page.commits.len()
        );
    }
}

/* ------------------------------ 2. 分页与 cursor ------------------------------ */

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
            again.next_cursor, cursor_records.get(index).cloned(),
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

/* ------------------------------ 3. generation ------------------------------ */

#[test]
fn old_cursor_is_stale_after_ref_changes() {
    let set = fixtures();
    let dir = temp_dir("generation");
    let repo = dir.join("forked");
    copy_dir(&set.forked(), &repo);

    let read = module(&repo);
    let first = read
        .read_graph_page(&GraphScope::All, None, 2)
        .expect("第一页");
    let cursor = first.next_cursor.clone().expect("还有下一页");
    let generation = first.generation;

    // 场景 A：移动已有分支 ref。
    git_ok(&repo, &["update-ref", "refs/heads/main", "refs/heads/feature"]);
    let after_move = read.current_generation().expect("新 generation");
    assert_ne!(after_move, generation, "移动 ref 必须改变 generation");
    let err = read
        .read_graph_page(&GraphScope::All, Some(&cursor), 2)
        .expect_err("移动 ref 后旧 cursor 必须失效");
    assert_eq!(err.code, ErrorCode::CursorStale, "必须是 CursorStale 而非静默错页");

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
    assert_ne!(read.current_generation().expect("新增后 generation"), stable_gen);
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

/* ------------------------------ 4. 只读安全 ------------------------------ */

#[test]
fn repository_is_not_mutated_by_reads() {
    let set = fixtures();
    let dir = temp_dir("readonly");
    let repo = dir.join("forked");
    copy_dir(&set.forked(), &repo);

    fn snapshot(root: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
        fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64, Option<std::time::SystemTime>)>) {
            for entry in std::fs::read_dir(dir).expect("遍历目录") {
                let entry = entry.expect("目录项");
                let path = entry.path();
                if entry.file_type().expect("类型").is_dir() {
                    walk(&path, out);
                } else {
                    let meta = entry.metadata().expect("元数据");
                    out.push((path, meta.len(), meta.modified().ok()));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, &mut out);
        out.sort();
        out
    }

    let before = snapshot(&repo);
    let read = module(&repo);
    let state = read.state().expect("state");
    let head = state.head.oid.clone().expect("HEAD");
    let _ = read.read_graph_page(&GraphScope::All, None, 50).expect("图谱");
    let _ = read.read_commit(&head).expect("commit 详情");
    let _ = read.read_file_diff(&head, "main.txt").expect("文件 diff");
    let base = oid_of(&read_oid(&repo, "HEAD~2"));
    let _ = read.compare(&base, &head, None).expect("compare");
    let after = snapshot(&repo);

    let before_map: std::collections::BTreeMap<PathBuf, (u64, Option<std::time::SystemTime>)> =
        before.into_iter().map(|(p, l, m)| (p, (l, m))).collect();
    let after_map: std::collections::BTreeMap<PathBuf, (u64, Option<std::time::SystemTime>)> =
        after.into_iter().map(|(p, l, m)| (p, (l, m))).collect();
    assert_eq!(
        before_map.keys().collect::<Vec<_>>(),
        after_map.keys().collect::<Vec<_>>(),
        "只读调用不得新增/删除仓库内文件"
    );
    for (path, meta) in &before_map {
        assert_eq!(after_map.get(path), Some(meta), "只读调用修改了 {}", path.display());
    }
    println!("READONLY files_unchanged={}", before_map.len());
}

#[test]
fn git_read_source_has_no_write_or_mutation_calls() {
    // 静态审计：只读模块源码不得包含写操作或写型 gix API。
    let sources = [
        ("lib.rs", include_str!("../src/lib.rs")),
        ("read.rs", include_str!("../src/read.rs")),
        ("diff.rs", include_str!("../src/diff.rs")),
        ("search.rs", include_str!("../src/search.rs")),
        ("util.rs", include_str!("../src/util.rs")),
        ("index.rs", include_str!("../src/index.rs")),
    ];

    let mut process_calls = 0usize;
    for (name, source) in sources {
        for forbidden in [
            "reference_mut(",
            "edit_reference",
            "write_tree(",
            "commit_as(",
            "worktree_mut(",
            "tag_mut(",
            "index_mut(",
            "gix::init",
            "gix::clone",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} 含写型/可变 gix 调用: {forbidden}"
            );
        }
        assert!(
            !source.contains(".args(["),
            "{name} 不得向子进程传参数组（唯一子进程只能是 git --version）"
        );
        assert!(
            !source.contains("\"--force\"") && !source.contains("\"--hard\""),
            "{name} 含破坏性参数"
        );
        process_calls += source.matches("Command::new").count();
    }

    // 唯一允许的子进程探测：`git --version`（只读版本查询）。
    assert_eq!(process_calls, 1, "只允许一次子进程调用（git --version）");
    let read_source = include_str!("../src/read.rs");
    let detect_start = read_source
        .find("fn detect_git_version")
        .expect("detect_git_version 存在");
    let detect_end = detect_start + read_source[detect_start..].find("fn version_at_least").unwrap();
    let detect = &read_source[detect_start..detect_end];
    assert!(detect.contains("Command::new(\"git\")"), "子进程必须是 git");
    assert!(detect.contains(".arg(\"--version\")"), "子进程参数只能是 --version");
    for write_word in [
        "commit",
        "update-ref",
        "push",
        "reset",
        "checkout",
        "switch",
        "merge",
        "cherry-pick",
        "revert",
        "gc",
        "repack",
        "worktree",
        "fetch",
    ] {
        assert!(
            !detect.contains(write_word),
            "版本探测子进程不得包含写型子命令: {write_word}"
        );
    }

    // 缓存写入只允许发生在 index.rs 的应用缓存目录中，且不写仓库。
    let index_source = include_str!("../src/index.rs");
    assert_eq!(
        index_source.matches("std::fs::write").count(),
        1,
        "缓存写入口应唯一"
    );
    assert!(index_source.contains("fn write_cache"), "缓存写入口明确");
    assert!(index_source.contains("cache_file_path"), "缓存路径来自 cache_dir");
    assert!(index_source.contains("dir.join("), "缓存文件写入缓存目录");
    for (name, source) in [
        ("read.rs", include_str!("../src/read.rs")),
        ("diff.rs", include_str!("../src/diff.rs")),
        ("search.rs", include_str!("../src/search.rs")),
        ("util.rs", include_str!("../src/util.rs")),
        ("lib.rs", include_str!("../src/lib.rs")),
    ] {
        assert!(
            !source.contains("std::fs::write") && !source.contains("std::fs::remove"),
            "{name} 不得写文件"
        );
    }
    println!("SOURCE AUDIT process_calls={process_calls} mutation_calls=0");
}

/* ------------------------------ 5. SHA-256 ------------------------------ */

#[test]
fn sha256_tag_detail_and_compare_are_usable() {
    let set = fixtures();
    let repo = set.sha256();
    let read = module(&repo);
    let state = read.state().expect("sha256 state");
    assert_eq!(state.object_format, ObjectFormat::Sha256);

    let head = state.head.oid.clone().expect("HEAD");
    assert_oid_len(&head, ObjectFormat::Sha256, "HEAD");
    assert_eq!(head.len(), 64);

    // annotated tag：直接目标为 tag 对象，peel 后为 commit，两者均 64 位。
    let tag = state
        .refs
        .iter()
        .find(|r| r.full_name == "refs/tags/sha-tag")
        .expect("sha-tag 存在");
    assert_eq!(tag.kind, RefKind::Tag);
    assert_eq!(tag.target_oid.len(), 64);
    assert_ne!(tag.target_oid, tag.commit_oid.clone().expect("tag 可 peel"));
    assert_eq!(
        tag.commit_oid.as_ref().map(Oid::as_str),
        Some(read_oid(&repo, "sha-tag^{commit}").as_str())
    );

    // 图谱：HEAD 与 tag 视图都能读到 2 个提交。
    let page = read
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("HEAD 图谱");
    assert_eq!(page.commits.len(), 2);
    let tag_page = read
        .read_graph_page(&GraphScope::Branch("sha-tag".to_owned()), None, 10)
        .expect("tag 视图");
    assert_eq!(tag_page.commits.len(), 2, "annotated tag 必须可 peel 成 commit 视图");

    // commit 详情。
    let detail = read.read_commit(&head).expect("sha256 commit 详情");
    assert_oid_len(&detail.commit.oid, ObjectFormat::Sha256, "detail oid");
    assert_eq!(detail.baseline, DiffBaselineDto::FirstParent);
    assert_eq!(detail.parents.len(), 1);
    assert_oid_len(&detail.parents[0], ObjectFormat::Sha256, "parent");
    let file = detail
        .files
        .iter()
        .find(|f| f.path == "sha.txt")
        .expect("sha.txt 变更");
    assert_eq!(file.status, FileStatus::Modified);
    assert_eq!((file.additions, file.deletions), (1, 0));
    for changed in &detail.files {
        for oid in [changed.old_oid.as_ref(), changed.new_oid.as_ref()]
            .into_iter()
            .flatten()
        {
            assert_oid_len(oid, ObjectFormat::Sha256, "blob oid");
        }
    }

    let diff = read
        .read_file_diff(&head, "sha.txt")
        .expect("sha256 文件 diff");
    assert!(
        diff.patch.as_deref().unwrap_or("").contains("+sha256-2"),
        "patch: {:?}",
        diff.patch
    );

    // compare：HEAD~1...HEAD。
    let parent = oid_of(&read_oid(&repo, "HEAD~1"));
    assert_eq!(parent.len(), 64);
    let result = read.compare(&parent, &head, None).expect("sha256 compare");
    assert_eq!(result.mode, CompareMode::ThreeDot);
    assert_eq!(result.merge_base.as_ref().map(Oid::as_str), Some(parent.as_str()));
    assert_eq!(result.base_only, 0);
    assert_eq!(result.compare_only, 1);
    assert_eq!(result.commits.len(), 1);
    assert_oid_len(&result.commits[0].oid, ObjectFormat::Sha256, "compare commit");
    assert!(result.files.iter().any(|f| f.path == "sha.txt"));
    assert!(result.warnings.iter().all(|w| w.code != "no_merge_base"));

    let file_diff = read
        .compare_file_diff(&parent, &head, "sha.txt")
        .expect("sha256 compare 文件");
    assert!(file_diff.patch.as_deref().unwrap_or("").contains("+sha256-2"));

    println!(
        "SHA256 head={} tag_object={} tag_commit={} commits={} compare_only={}",
        head,
        tag.target_oid,
        tag.commit_oid.as_ref().map(Oid::as_str).unwrap_or("-"),
        page.commits.len(),
        result.compare_only
    );
}

/* ------------------------------ 6. 性能 ------------------------------ */

fn build_linear_repo(dir: &Path, commits: usize) {
    std::fs::create_dir_all(dir).expect("创建性能仓库目录");
    git_ok(dir, &["init", "-q", "-b", "main"]);
    let mut stream = String::new();
    for i in 0..commits {
        let timestamp = 1_700_000_000 + i as i64;
        let msg = format!("perf commit {i}");
        let content = format!("commit {i}\n");
        stream.push_str("commit refs/heads/main\n");
        stream.push_str(&format!("committer Perf <perf@example.com> {timestamp} +0000\n"));
        stream.push_str(&format!("data {}\n{}\n", msg.len(), msg));
        stream.push_str("M 644 inline file.txt\n");
        stream.push_str(&format!("data {}\n{}", content.len(), content));
        stream.push('\n');
    }
    let mut child = Command::new("git")
        .current_dir(dir)
        .args(["fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("启动 fast-import");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(stream.as_bytes())
        .expect("写入 fast-import 流");
    let status = child.wait().expect("等待 fast-import");
    assert!(status.success(), "fast-import 失败");
}

fn timed_open_and_first_page(path: &Path, cache: Option<PathBuf>) -> (f64, usize, bool) {
    let start = Instant::now();
    let read = GitReadModule::open(path, cache).expect("打开仓库");
    let page = read
        .read_graph_page(&GraphScope::Head, None, 200)
        .expect("首页 200 行");
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    (elapsed, page.commits.len(), page.has_more)
}

#[test]
fn perf_200_row_first_page_and_cached_index() {
    let dir = temp_dir("perf");
    let repo = dir.join("perf");
    build_linear_repo(&repo, 200);

    // 冷读：不带缓存目录，每次都重新遍历 + 拓扑排序。
    let mut cold = Vec::new();
    let mut rows = 0;
    for _ in 0..3 {
        let (ms, count, has_more) = timed_open_and_first_page(&repo, None);
        rows = count;
        assert_eq!(count, 200, "首页应返回 200 行");
        assert!(!has_more, "200 行即全部历史");
        cold.push(ms);
    }
    let cold_median = median_ms(cold.clone());

    // 缓存命中：先预热一次写入索引缓存，再用同一缓存目录重复打开 + 首页。
    let cache = dir.join("cache");
    let _ = timed_open_and_first_page(&repo, Some(cache.clone()));
    let mut cached = Vec::new();
    for _ in 0..3 {
        let (ms, count, _) = timed_open_and_first_page(&repo, Some(cache.clone()));
        assert_eq!(count, 200);
        cached.push(ms);
    }
    let cached_median = median_ms(cached.clone());

    // 以宽松上限防止 CI 抖动误报，同时真实数值打印到报告。
    assert!(
        cold_median < 5000.0,
        "冷读首页中位数过高: {cold_median:.2}ms"
    );
    assert!(
        cached_median < 2000.0,
        "缓存命中首页耗时应低于 2s: {cached_median:.2}ms"
    );

    println!(
        "PERF rows={rows} cold_ms={:?} cold_median={cold_median:.2} cached_ms={:?} cached_median={cached_median:.2}",
        cold.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>(),
        cached.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>()
    );
}
