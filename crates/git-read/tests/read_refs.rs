//! refs / HEAD / 仓库状态读取：本地分支描述、包含关系、分支差异与对象格式检测。

mod common;

use common::*;
use git_core::{GraphScope, HeadKind, ObjectFormat, Oid, RefKind};
use test_support::{current_head, fixtures, git_ok, init_repo, oid_of, read_oid, temp_dir, write};

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
    assert_ne!(
        tag.target_oid,
        tag.commit_oid.clone().expect("tag 指向提交")
    );
    assert_eq!(
        tag.commit_oid.as_ref().map(Oid::as_str),
        Some(read_oid(&set.linear(), "v1.0^{commit}").as_str())
    );
    // 创建时间：annotated tag 取 tagger 时间，与 git for-each-ref 的 creatordate 一致。
    let tagger = git_ok(
        &set.linear(),
        &[
            "for-each-ref",
            "--format=%(taggerdate:unix)",
            "refs/tags/v1.0",
        ],
    );
    assert_eq!(tag.created_at, tagger.parse::<i64>().ok());
    // 附注标签的 message 即界面上的「描述」。
    assert_eq!(tag.description.as_deref(), Some("release 1.0"));

    let lightweight = state
        .refs
        .iter()
        .find(|r| r.short_name == "v1.1")
        .expect("轻量 tag");
    assert_eq!(lightweight.kind, RefKind::Tag);
    // 轻量 tag 没有真实创建时间，回退到被指向提交的提交时间。
    let commit_time = git_ok(
        &set.linear(),
        &[
            "for-each-ref",
            "--format=%(creatordate:unix)",
            "refs/tags/v1.1",
        ],
    );
    assert_eq!(lightweight.created_at, commit_time.parse::<i64>().ok());
    // 轻量标签没有附注消息，也就没有描述。
    assert_eq!(lightweight.description, None);

    // generation 对同一仓库状态是稳定的。
    assert_eq!(
        state.generation,
        read.current_generation().expect("generation")
    );

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
fn local_branch_descriptions_come_from_local_config() {
    let dir = temp_dir("git-graph-read-branch-description");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);
    write(&repo.join("readme.txt"), "root\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "root"]);
    git_ok(&repo, &["branch", "topic"]);
    git_ok(
        &repo,
        &[
            "config",
            "--local",
            "branch.main.description",
            "主分支 / main",
        ],
    );
    git_ok(
        &repo,
        &["config", "--local", "branch.topic.description", "特性分支"],
    );
    // 空值按未设置处理，不应出现在描述中。
    git_ok(
        &repo,
        &["config", "--local", "branch.empty.description", ""],
    );
    git_ok(&repo, &["update-ref", "refs/heads/empty", "HEAD"]);

    let read = module(&repo);
    let state = read.state().expect("读取状态");
    let branch = |name: &str| {
        state
            .refs
            .iter()
            .find(|r| r.short_name == name)
            .unwrap_or_else(|| panic!("缺少本地分支 {name}"))
    };
    assert_eq!(branch("main").description.as_deref(), Some("主分支 / main"));
    assert_eq!(branch("topic").description.as_deref(), Some("特性分支"));
    assert_eq!(branch("empty").description, None);

    let page = read
        .read_graph_page(&GraphScope::All, None, 200)
        .expect("读取全量图谱");
    let badge = page
        .commits
        .iter()
        .flat_map(|commit| &commit.refs)
        .find(|badge| badge.name == "topic")
        .expect("topic 标签");
    assert_eq!(badge.description.as_deref(), Some("特性分支"));
}

#[test]
fn branches_containing_reflects_merge_ancestry() {
    let set = fixtures();
    let read = module(&set.forked());
    let main_tip = oid_of(&read_oid(&set.forked(), "main"));
    let feature_tip = oid_of(&read_oid(&set.forked(), "feature"));

    // main 已合并 feature：两个分支都包含 feature tip。
    let mut containing_feature = read
        .branches_containing(&feature_tip)
        .expect("查询 feature tip 所在分支");
    containing_feature.sort();
    assert_eq!(
        containing_feature,
        vec!["feature".to_string(), "main".to_string()]
    );

    // main tip 只被 main 包含。
    let containing_main = read
        .branches_containing(&main_tip)
        .expect("查询 main tip 所在分支");
    assert_eq!(containing_main, vec!["main".to_string()]);

    // 非本地分支（remote tracking）不计入结果。
    assert!(!containing_main.iter().any(|name| name.contains("origin")));
}

#[test]
fn commit_branch_context_reports_branch_gaps() {
    let set = fixtures();
    let read = module(&set.forked());
    let feature_tip = oid_of(&read_oid(&set.forked(), "feature"));

    let context = read
        .commit_branch_context(&feature_tip, 3)
        .expect("读取提交所属分支");
    assert_eq!(context.current_branch.as_deref(), Some("main"));
    assert!(context.oid == feature_tip);
    assert!(context.branches.contains(&"feature".to_string()));
    assert!(context.branches.contains(&"main".to_string()));

    let gap = context
        .gaps
        .iter()
        .find(|gap| gap.name == "feature")
        .expect("feature 分支差异");
    assert_eq!(gap.tip, feature_tip);
    // main 已合并 feature：feature 没有 HEAD 缺少的提交。
    assert_eq!(gap.branch_only, 0);
    assert!(gap.branch_only_commits.is_empty());
    // HEAD 独有 main c3、merge、main after merge 三条。
    assert_eq!(gap.head_only, 3);
    assert_eq!(gap.head_only_commits.len(), 3);
    assert!(!gap.head_only_truncated);

    let limited = read
        .commit_branch_context(&feature_tip, 1)
        .expect("限制条数读取提交所属分支");
    let limited_gap = limited
        .gaps
        .iter()
        .find(|gap| gap.name == "feature")
        .expect("feature 分支差异");
    assert_eq!(limited_gap.head_only_commits.len(), 1);
    assert!(limited_gap.head_only_truncated);
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
fn empty_scope_reports_warning() {
    let dir = temp_dir("git-graph-read-unborn");
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
