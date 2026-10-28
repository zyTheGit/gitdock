//! GitReadModule 公开接口集成测试：全部基于仓库夹具，不触碰私有实现。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use git_core::{
    CompareMode, ErrorCode, FileStatus, GraphScope, HeadKind, ObjectFormat, Oid, RefKind,
    SearchField, SearchRequest,
};
use git_read::GitReadModule;
use test_support::{current_head, fixtures, git_ok, read_oid, write};

fn module(path: &Path) -> GitReadModule {
    GitReadModule::open(path, None).expect("打开夹具仓库")
}

fn oid_of(text: &str) -> Oid {
    Oid::new(text).expect("合法 OID")
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("git-graph-read-{}-{}", name, std::process::id()));
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

fn init_repo(dir: &Path) {
    git_ok(dir, &["init", "-q", "-b", "main"]);
    git_ok(dir, &["config", "user.name", "Test"]);
    git_ok(dir, &["config", "user.email", "test@example.com"]);
    git_ok(dir, &["config", "core.autocrlf", "false"]);
}

#[test]
fn linear_state_refs_and_head() {
    let set = fixtures();
    let read = module(&set.linear());
    let state = read.state().expect("读取状态");

    assert_eq!(state.object_format, ObjectFormat::Sha1);
    assert!(!state.is_bare);
    assert!(!state.is_shallow);
    assert_eq!(state.head.kind, HeadKind::Branch);
    assert_eq!(state.head.branch.as_deref(), Some("main"));
    assert_eq!(
        state.head.oid.as_ref().map(Oid::as_str),
        Some(current_head(&set.linear()).as_str())
    );

    let main = state
        .refs
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .expect("本地分支 main");
    assert_eq!(main.kind, RefKind::LocalBranch);
    assert!(main.is_head);

    let remote = state
        .refs
        .iter()
        .find(|r| r.short_name == "origin/topic")
        .expect("远程跟踪 ref");
    assert_eq!(remote.kind, RefKind::RemoteBranch);

    let tag = state
        .refs
        .iter()
        .find(|r| r.short_name == "v1.0")
        .expect("注释 tag");
    assert_eq!(tag.kind, RefKind::Tag);
    // annotated tag 的直接目标不是 commit，peel 后才是。
    assert_ne!(tag.target_oid, tag.commit_oid.clone().expect("tag 指向提交"));
    assert_eq!(
        tag.commit_oid.as_ref().map(Oid::as_str),
        Some(read_oid(&set.linear(), "v1.0^{commit}").as_str())
    );

    // generation 对同一仓库状态是稳定的。
    assert_eq!(state.generation, read.current_generation().expect("generation"));

    let page = read
        .read_graph_page(&GraphScope::Head, None, 200)
        .expect("读取头部视图");
    assert_eq!(page.view_key, "head");
    assert_eq!(page.commits.len(), 6);
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
    assert_eq!(page.layout.len(), page.commits.len());
    assert!(page.layout.iter().all(|row| row.lane == 0));
}

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
    let dir = temp_dir("stale");
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
fn commit_detail_reports_files_and_root_baseline() {
    let set = fixtures();
    let read = module(&set.linear());

    let head = oid_of(&current_head(&set.linear()));
    let detail = read.read_commit(&head).expect("读取 HEAD 详情");
    assert_eq!(detail.commit.oid, head);
    assert_eq!(detail.commit.summary, "linear commit 6");
    let changed = detail
        .files
        .iter()
        .find(|f| f.path == "linear.txt")
        .expect("变更文件 linear.txt");
    assert_eq!(changed.status, FileStatus::Modified);
    assert_eq!(changed.additions, 1);
    assert!(!changed.binary);

    let root = oid_of(&read_oid(&set.linear(), "HEAD~5"));
    let root_detail = read.read_commit(&root).expect("读取根提交");
    assert!(root_detail.parents.is_empty());
    assert_eq!(root_detail.baseline, git_core::DiffBaselineDto::Root);
    assert_eq!(root_detail.files[0].status, FileStatus::Added);

    let diff = read
        .read_file_diff(&head, "linear.txt")
        .expect("读取文件 diff");
    let patch = diff.patch.expect("文本 diff 应有 patch");
    assert!(patch.contains("+line 6"), "patch 内容: {patch}");
    assert!(!diff.binary);
    assert!(!diff.truncated);
}

#[test]
fn binary_encoding_and_gitlink_degrade_gracefully() {
    let dir = temp_dir("degrade");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);

    write(&repo.join("bin.dat"), "plain\n");
    write(&repo.join("utf16.txt"), "ascii\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "base"]);

    std::fs::write(repo.join("bin.dat"), [0u8, 1, 2, 3]).expect("写入二进制");
    let utf16: Vec<u8> = {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "中文".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes
    };
    std::fs::write(repo.join("utf16.txt"), utf16).expect("写入 UTF-16");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "binary and utf16"]);

    let head = oid_of(&current_head(&repo));
    let sub_oid = current_head(&repo);
    let gitlink_arg = format!("160000,{sub_oid},vendor");
    git_ok(
        &repo,
        &["update-index", "--add", "--cacheinfo", gitlink_arg.as_str()],
    );
    git_ok(&repo, &["commit", "-q", "-m", "add gitlink"]);

    let read = module(&repo);

    let binary = read.read_file_diff(&head, "bin.dat").expect("二进制 diff");
    assert!(binary.binary);
    assert!(binary.patch.is_none(), "二进制不得输出 patch");

    let utf16_diff = read.read_file_diff(&head, "utf16.txt").expect("UTF-16 diff");
    assert!(utf16_diff.encoding_fallback, "UTF-16 应标记编码降级");
    assert!(utf16_diff.patch.as_deref().unwrap_or("").contains("中文"));

    let head = oid_of(&current_head(&repo));
    let gitlink = read.read_file_diff(&head, "vendor").expect("gitlink diff");
    assert!(gitlink.gitlink);
    assert!(gitlink.patch.is_none());
    assert!(gitlink.note.as_deref().unwrap_or("").contains("子模块"));
}

#[test]
fn compare_three_dot_uses_merge_base() {
    let set = fixtures();
    let read = module(&set.forked());
    let main = oid_of(&read_oid(&set.forked(), "main"));
    let feature = oid_of(&read_oid(&set.forked(), "feature"));

    // feature 已合入 main，因此 merge-base 就是 feature 顶端：
    // 反向对比 `feature...main` 才包含 main 侧新增内容。
    let result = read.compare(&feature, &main, None).expect("三点对比");
    assert_eq!(result.mode, CompareMode::ThreeDot);
    assert_eq!(
        result.merge_base.as_ref().map(Oid::as_str),
        Some(feature.as_str())
    );
    assert_eq!(result.base_only, 0);
    assert_eq!(result.compare_only, 3, "main 侧独有：合并前、merge 与合并后提交");
    assert!(result.files.iter().any(|f| f.path == "main.txt"));
    assert_eq!(result.commits.len(), 3);
    assert!(result.warnings.iter().all(|w| w.code != "no_merge_base"));

    let filtered = read
        .compare(&feature, &main, Some("main.txt"))
        .expect("路径过滤");
    assert!(filtered.files.iter().all(|f| f.path == "main.txt"));

    let file_diff = read
        .compare_file_diff(&feature, &main, "main.txt")
        .expect("对比单文件");
    assert!(file_diff.patch.is_some());
}

#[test]
fn compare_without_merge_base_falls_back() {
    let dir = temp_dir("no-merge-base");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);
    write(&repo.join("main.txt"), "main\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "main root"]);
    let main = oid_of(&current_head(&repo));

    git_ok(&repo, &["checkout", "-q", "--orphan", "other"]);
    git_ok(&repo, &["rm", "-rf", "-q", "."]);
    write(&repo.join("other.txt"), "other\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "other root"]);
    let other = oid_of(&current_head(&repo));

    let read = module(&repo);
    let result = read.compare(&main, &other, None).expect("降级对比");
    assert_eq!(result.mode, CompareMode::TwoDotFallback);
    assert!(result.merge_base.is_none());
    assert_eq!(result.base_only, 1);
    assert_eq!(result.compare_only, 1);
    assert!(result.commits.iter().any(|c| c.oid == other));
    assert!(result.warnings.iter().any(|w| w.code == "no_merge_base"));
}

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
    assert!(author.results.iter().all(|r| r.fields.contains(&SearchField::Author)));

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
fn sha256_repository_uses_64_char_oids() {
    let set = fixtures();
    let read = module(&set.sha256());
    let state = read.state().expect("读取 SHA-256 状态");
    assert_eq!(state.object_format, ObjectFormat::Sha256);
    assert!(state.warnings.iter().any(|w| w.code == "sha256_repository"));

    let page = read
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("读取 SHA-256 图谱");
    assert_eq!(page.commits.len(), 2);
    assert!(page.commits.iter().all(|c| c.oid.len() == 64));
    assert!(page.layout.iter().all(|row| row.oid.len() == 64));
}

#[test]
fn shallow_bare_and_linked_worktree_are_detected() {
    let set = fixtures();

    let shallow = module(&set.shallow()).state().expect("读取 shallow 状态");
    assert!(shallow.is_shallow);
    let shallow_page = module(&set.shallow())
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("读取 shallow 图谱");
    assert!(!shallow_page.commits.is_empty());

    let bare_module = module(&set.bare());
    let bare = bare_module.state().expect("读取 bare 状态");
    assert!(bare.is_bare);
    assert!(!bare.is_linked_worktree);
    let bare_page = bare_module
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("读取 bare 图谱");
    assert_eq!(bare_page.commits.len(), 6);

    let linked = module(&set.worktree_linked())
        .state()
        .expect("读取 linked worktree 状态");
    assert!(linked.is_linked_worktree);
    assert!(!linked.is_bare);
}

#[test]
fn index_cache_is_reused_between_reads() {
    let set = fixtures();
    let cache = temp_dir("cache");
    let read =
        GitReadModule::open(&set.linear(), Some(cache.clone())).expect("带缓存目录打开仓库");

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

#[test]
fn empty_scope_reports_warning() {
    let dir = temp_dir("unborn");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);

    let read = module(&repo);
    let state = read.state().expect("读取未出生 HEAD");
    assert_eq!(state.head.kind, HeadKind::Unborn);
    assert!(state.refs.is_empty());

    let page = read
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("空仓库分页");
    assert!(page.commits.is_empty());
    assert!(!page.has_more);
    assert!(page.warnings.iter().any(|w| w.code == "empty_repository"));
}
