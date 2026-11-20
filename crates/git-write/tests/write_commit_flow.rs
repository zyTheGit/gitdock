//! Cherry-pick / revert 的 Gate 校验与提交流程（不含冲突中断的继续/中止）。

mod common;

use common::*;
use git_core::{WriteKind, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

#[test]
fn gate_rejects_untracked_and_allows_clean() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let target = commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    write(&dir.join("untracked.txt"), "u\n");
    let report = module
        .validate(&request(WriteKind::CherryPick, Some(&target), None, None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_worktree_dirty"));

    std::fs::remove_file(dir.join("untracked.txt")).expect("删除未跟踪文件");
    let report = module
        .validate(&request(WriteKind::CherryPick, Some(&target), None, None))
        .expect("Gate");
    assert!(report.ok, "干净工作区应通过：{:?}", report.issues);
}

#[test]
fn gate_requires_mainline_for_merge_commit() {
    let (temp, merge, _, _) = merge_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&pick_request(WriteKind::CherryPick, &merge, None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report.is_merge_commit);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_mainline_required"));
    assert_eq!(report.parents.len(), 2);

    let first = module
        .validate(&pick_request(WriteKind::CherryPick, &merge, Some(1)))
        .expect("Gate");
    assert!(first.ok, "合法 mainline 应通过：{:?}", first.issues);
    assert!(
        first.summary.contains("以第 1 父提交为基线（1/2）"),
        "{}",
        first.summary
    );

    // Q1：允许任意合法父序号，第 2 父同样放行。
    let second = module
        .validate(&pick_request(WriteKind::Revert, &merge, Some(2)))
        .expect("Gate");
    assert!(second.ok, "第 2 父应通过：{:?}", second.issues);
    assert!(second.summary.contains("以第 2 父提交为基线（2/2）"));
}

#[test]
fn gate_rejects_invalid_or_inapplicable_mainline() {
    let (temp, merge, _, _) = merge_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    for mainline in [0u32, 3] {
        let report = module
            .validate(&pick_request(WriteKind::CherryPick, &merge, Some(mainline)))
            .expect("Gate");
        assert!(!report.ok, "-m {mainline} 应被拒绝");
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.code == "gate_mainline_invalid"),
            "-m {mainline}: {:?}",
            report.issues
        );
    }

    let temp2 = init_temp_repo();
    let dir2 = temp2.path();
    let target = commit(dir2, "a.txt", "one\n", "c1");
    commit(dir2, "a.txt", "two\n", "c2");
    let module2 = GitWriteModule::new(dir2).expect("打开写模块");
    let report = module2
        .validate(&pick_request(WriteKind::CherryPick, &target, Some(1)))
        .expect("Gate");
    assert!(!report.ok);
    assert!(!report.is_merge_commit);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_mainline_not_applicable"));
}

#[test]
fn gate_lists_merge_parents_in_mainline_order() {
    let (temp, merge, main_tip, feature_tip) = merge_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&pick_request(WriteKind::CherryPick, &merge, None))
        .expect("Gate");
    assert_eq!(report.parents.len(), 2);
    assert_eq!(report.parents[0].oid.as_str(), main_tip);
    assert_eq!(report.parents[1].oid.as_str(), feature_tip);
    for parent in &report.parents {
        assert!(!parent.short_oid.is_empty(), "{parent:?}");
        assert!(parent.short_oid.len() < parent.oid.as_str().len());
    }
    assert_eq!(report.parents[0].summary, "main 分支");
    assert_eq!(report.parents[1].summary, "feature 分支");
}

#[test]
fn cherry_pick_merge_commit_with_mainline_succeeds() {
    let (temp, merge, _, _) = merge_repo();
    let dir = temp.path();
    git_ok(dir, &["switch", "-c", "probe", "HEAD~1"]);
    let before = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&pick_request(WriteKind::CherryPick, &merge, Some(1)))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_ne!(git_ok(dir, &["rev-parse", "HEAD"]).trim(), before);
    assert!(dir.join("feature.txt").exists());
}

#[test]
fn gate_rejects_detached_head() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let target = commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    git_ok(dir, &["checkout", "--detach", "HEAD~1"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(WriteKind::Revert, Some(&target), None, None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_detached_head"));
}

#[test]
fn cherry_pick_success_updates_head() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git_ok(dir, &["switch", "-c", "feature"]);
    let feature = commit(dir, "b.txt", "feature\n", "feature");
    git_ok(dir, &["switch", "main"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(dir, &["rev-parse", "HEAD"]).trim(),
        outcome.head_oid.expect("head").as_str()
    );
    assert!(dir.join("b.txt").exists());
}

#[test]
fn cherry_pick_conflict_is_reported_without_abort() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    assert!(outcome
        .conflict_files
        .iter()
        .any(|file| file == "conflict.txt"));

    // 本应用不得自动 abort：CHERRY_PICK_HEAD 必须仍然存在。
    let marker = dir.join(".git").join("CHERRY_PICK_HEAD");
    assert!(marker.exists(), "应用不得自动清理冲突态");

    let blocked = module
        .validate(&request(WriteKind::Revert, Some(&feature), None, None))
        .expect("Gate");
    assert!(!blocked.ok);
    assert!(blocked
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interrupted"));

    let interruption = module.inspect_interruption().expect("探测中断");
    assert!(interruption.is_active());
    assert!(!interruption.terminal_hint.is_empty());
}

#[test]
fn empty_pick_cleans_own_marker() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "base.txt", "base\n", "base");
    let same = commit(dir, "same.txt", "same\n", "加入 same.txt");
    git_ok(dir, &["switch", "-c", "target", "HEAD~1"]);
    commit(dir, "same.txt", "same\n", "target 也有 same.txt");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&same), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::EmptyPick, "{outcome:?}");
    assert!(!dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert!(
        !module.inspect_interruption().expect("探测中断").is_active(),
        "空 pick 后不应残留中断态"
    );
}
