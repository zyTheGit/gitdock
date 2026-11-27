//! 提交详情与两/三点对比：文件清单、patch 降级与 merge-base 语义。

mod common;

use common::*;
use git_core::{CompareChangeOrigin, CompareMode, FileStatus, Oid};
use test_support::{current_head, fixtures, git_ok, init_repo, oid_of, read_oid, temp_dir, write};

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
        .read_file_diff(&head, "linear.txt", false)
        .expect("读取文件 diff");
    let patch = diff.patch.expect("文本 diff 应有 patch");
    assert!(patch.contains("+line 6"), "patch 内容: {patch}");
    assert!(!diff.binary);
    assert!(!diff.truncated);
}

#[test]
fn binary_encoding_and_gitlink_degrade_gracefully() {
    let dir = temp_dir("git-graph-read-degrade");
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

    let binary = read
        .read_file_diff(&head, "bin.dat", false)
        .expect("二进制 diff");
    assert!(binary.binary);
    assert!(binary.patch.is_none(), "二进制不得输出 patch");

    let utf16_diff = read
        .read_file_diff(&head, "utf16.txt", false)
        .expect("UTF-16 diff");
    assert!(utf16_diff.encoding_fallback, "UTF-16 应标记编码降级");
    assert!(utf16_diff.patch.as_deref().unwrap_or("").contains("中文"));

    let head = oid_of(&current_head(&repo));
    let gitlink = read
        .read_file_diff(&head, "vendor", false)
        .expect("gitlink diff");
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
    let result = read
        .compare(&feature, &main, None, false)
        .expect("三点对比");
    assert_eq!(result.mode, CompareMode::ThreeDot);
    assert_eq!(
        result.merge_base.as_ref().map(Oid::as_str),
        Some(feature.as_str())
    );
    assert_eq!(result.base_only, 0);
    assert_eq!(
        result.compare_only, 3,
        "main 侧独有：合并前、merge 与合并后提交"
    );
    assert!(result.files.iter().any(|f| f.path == "main.txt"));
    assert_eq!(result.commits.len(), 3);
    assert!(result.warnings.iter().all(|w| w.code != "no_merge_base"));

    let filtered = read
        .compare(&feature, &main, Some("main.txt"), false)
        .expect("路径过滤");
    assert!(filtered.files.iter().all(|f| f.path == "main.txt"));

    let file_diff = read
        .compare_file_diff(&feature, &main, "main.txt", false, false)
        .expect("对比单文件");
    assert!(file_diff.patch.is_some());

    // 反向选择（Base=main、Compare=已合入的 feature）时三点 diff 为空；
    // 两点快照必须能显示两端完整差异。
    let empty = read
        .compare(&main, &feature, None, false)
        .expect("三点反向对比");
    assert!(empty.files.is_empty(), "三点 diff 应为空");
    let snapshot = read
        .compare(&main, &feature, None, true)
        .expect("两点快照对比");
    assert_eq!(snapshot.mode, CompareMode::TwoDot);
    assert_eq!(
        snapshot.merge_base.as_ref().map(Oid::as_str),
        Some(feature.as_str())
    );
    assert!(snapshot
        .files
        .iter()
        .any(|f| f.path == "main.txt" && f.status == FileStatus::Deleted));
    let snapshot_file = read
        .compare_file_diff(&main, &feature, "main.txt", true, false)
        .expect("两点单文件");
    assert!(snapshot_file.patch.is_some(), "两点 diff 应包含完整补丁");
}

#[test]
fn compare_without_merge_base_falls_back() {
    let dir = temp_dir("git-graph-read-no-merge-base");
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
    let result = read.compare(&main, &other, None, false).expect("降级对比");
    assert_eq!(result.mode, CompareMode::TwoDotFallback);
    assert!(result.merge_base.is_none());
    assert_eq!(result.base_only, 1);
    assert_eq!(result.compare_only, 1);
    assert!(result.commits.iter().any(|c| c.oid == other));
    assert!(result.base_commits.is_empty());
    assert!(result.merge_base_summary.is_none());
    assert!(result.files.iter().all(|f| f.change_origin.is_none()));
    assert!(result.warnings.iter().any(|w| w.code == "no_merge_base"));
}

#[test]
fn compare_diverged_branches_reports_bidirectional_commits_and_change_origin() {
    let dir = temp_dir("git-graph-read-diverged-compare");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);

    write(&repo.join("shared.txt"), "base\n");
    write(&repo.join("base-only.txt"), "base\n");
    write(&repo.join("comp-only.txt"), "comp\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "common ancestor"]);
    let mb = oid_of(&current_head(&repo));

    git_ok(&repo, &["checkout", "-q", "-b", "feat"]);
    write(&repo.join("shared.txt"), "feat change\n");
    write(&repo.join("comp-only.txt"), "feat change\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "feat commit"]);
    let feat = oid_of(&current_head(&repo));

    git_ok(&repo, &["checkout", "-q", "main"]);
    write(&repo.join("shared.txt"), "main change\n");
    write(&repo.join("base-only.txt"), "main change\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "main commit 1"]);
    write(&repo.join("base-extra.txt"), "extra\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "main commit 2"]);
    let main = oid_of(&current_head(&repo));

    let read = module(&repo);
    let three_dot = read
        .compare(&main, &feat, None, false)
        .expect("分叉三点对比");
    assert_eq!(three_dot.merge_base, Some(mb.clone()));
    assert_eq!(
        three_dot.merge_base_summary.as_deref(),
        Some("common ancestor")
    );
    assert_eq!(three_dot.base_only, 2);
    assert_eq!(three_dot.compare_only, 1);
    assert_eq!(three_dot.base_commits.len(), 2);
    assert_eq!(three_dot.commits.len(), 1);
    assert_eq!(
        three_dot
            .files
            .iter()
            .find(|f| f.path == "shared.txt")
            .and_then(|f| f.change_origin),
        Some(CompareChangeOrigin::Both)
    );
    assert_eq!(
        three_dot
            .files
            .iter()
            .find(|f| f.path == "comp-only.txt")
            .and_then(|f| f.change_origin),
        Some(CompareChangeOrigin::CompareOnly)
    );

    let two_dot = read
        .compare(&main, &feat, None, true)
        .expect("分叉两点对比");
    assert_eq!(two_dot.mode, CompareMode::TwoDot);
    assert_eq!(two_dot.base_commits.len(), 2);
    assert_eq!(
        two_dot
            .files
            .iter()
            .find(|f| f.path == "shared.txt")
            .and_then(|f| f.change_origin),
        Some(CompareChangeOrigin::Both)
    );
    assert_eq!(
        two_dot
            .files
            .iter()
            .find(|f| f.path == "comp-only.txt")
            .and_then(|f| f.change_origin),
        Some(CompareChangeOrigin::CompareOnly)
    );
    assert_eq!(
        two_dot
            .files
            .iter()
            .find(|f| f.path == "base-only.txt")
            .and_then(|f| f.change_origin),
        Some(CompareChangeOrigin::BaseOnly)
    );
}

#[test]
fn compare_detects_cherry_picked_equivalent_commits() {
    let dir = temp_dir("git-graph-read-cherry-equiv");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);

    write(&repo.join("app.txt"), "line 1\nline 2\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "init"]);

    git_ok(&repo, &["checkout", "-q", "-b", "feat"]);
    write(&repo.join("app.txt"), "line 1\nline 2\nfix from feat\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "fix: bug A"]);
    let feat_fix = oid_of(&current_head(&repo));

    write(&repo.join("only-feat.txt"), "feat only\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "feat: unique work"]);
    let feat_tip = oid_of(&current_head(&repo));

    git_ok(&repo, &["checkout", "-q", "main"]);
    write(&repo.join("main-only.txt"), "main work\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "main: divergent commit"]);
    git_ok(&repo, &["cherry-pick", feat_fix.as_str()]);
    let main_pick = oid_of(&current_head(&repo));
    assert_ne!(feat_fix, main_pick);

    let read = module(&repo);
    let result = read
        .compare(&main_pick, &feat_tip, None, false)
        .expect("对比含 cherry-pick 的分叉分支");
    assert_eq!(
        result
            .equivalent_commits
            .get(feat_fix.as_str())
            .map(String::as_str),
        Some(main_pick.as_str())
    );
    assert_eq!(
        result
            .equivalent_commits
            .get(main_pick.as_str())
            .map(String::as_str),
        Some(feat_fix.as_str())
    );
    assert!(!result.equivalent_commits.contains_key(feat_tip.as_str()));
}

#[test]
fn compare_identical_commit_fast_path_reports_zero_diff() {
    let set = fixtures();
    let read = module(&set.linear());
    let head = oid_of(&current_head(&set.linear()));

    let result = read.compare(&head, &head, None, false).expect("同提交对比");
    assert_eq!(result.base_only, 0);
    assert_eq!(result.compare_only, 0);
    assert!(result.files.is_empty());
    assert!(result.commits.is_empty());
    assert!(result.base_commits.is_empty());
    assert!(result.equivalent_commits.is_empty());
}

#[test]
fn compare_skips_equiv_when_commit_touches_too_many_files() {
    let dir = temp_dir("git-graph-read-equiv-file-cap");
    let repo = dir.join("repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录");
    init_repo(&repo);

    write(&repo.join("base.txt"), "base\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "init"]);

    git_ok(&repo, &["checkout", "-q", "-b", "feat"]);
    for i in 0..55 {
        write(
            &repo.join(format!("bulk_{i:02}.txt")),
            &format!("line {i}\n"),
        );
    }
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "feat: bulk add 55 files"]);
    let feat_bulk = oid_of(&current_head(&repo));

    git_ok(&repo, &["checkout", "-q", "main"]);
    write(&repo.join("main.txt"), "main\n");
    git_ok(&repo, &["add", "-A"]);
    git_ok(&repo, &["commit", "-q", "-m", "main work"]);
    git_ok(&repo, &["cherry-pick", feat_bulk.as_str()]);
    let main_pick = oid_of(&current_head(&repo));

    let read = module(&repo);
    let result = read
        .compare(&main_pick, &feat_bulk, None, false)
        .expect("超过单提交文件数上限时对比应正常完成");
    assert!(!result.equivalent_commits.contains_key(feat_bulk.as_str()));
    assert!(!result.equivalent_commits.contains_key(main_pick.as_str()));
}
