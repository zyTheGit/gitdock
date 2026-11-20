//! 本地重置 soft / mixed / hard（ADR-0029）。
//!
//! 覆盖三种模式的作用面、Gate 的拒绝条件（非法目标、unborn、无效果重置）与两条 warning：
//! 硬重置的破坏性提示（含受影响路径）与「目标落后于上游」的分叉提示。

mod common;

use std::path::Path;

use common::*;
use git_core::{GateReportDto, Oid, ResetMode, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, current_head, git_ok, init_temp_repo, write};

fn reset_request(oid: &str, mode: ResetMode) -> WriteRequest {
    WriteRequest {
        oid: Some(Oid::new(oid).expect("oid")),
        reset_mode: Some(mode),
        ..base_request(WriteKind::Reset)
    }
}

fn issue_codes(report: &GateReportDto) -> Vec<String> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.clone())
        .collect()
}

fn warning_codes(report: &GateReportDto) -> Vec<String> {
    report
        .warnings
        .iter()
        .map(|warning| warning.code.clone())
        .collect()
}

fn write_file(dir: &Path, name: &str, content: &str) {
    write(&dir.join(name), content);
}

#[test]
fn soft_reset_moves_branch_and_keeps_everything_staged() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let target = current_head(dir);
    commit(dir, "b.txt", "b\n", "c2");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = reset_request(&target, ResetMode::Soft);

    let gate = module.validate(&request).expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(gate.summary_key.as_deref(), Some("errors.gateSummaryReset"));
    assert!(gate.warnings.is_empty(), "{:?}", gate.warnings);

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeResetSoft"));
    assert_eq!(
        outcome
            .args
            .as_ref()
            .and_then(|args| args.get("oid"))
            .map(String::as_str),
        Some(&target[..8])
    );

    // 分支指针回退，c2 的改动整份留在暂存区（A  = 已暂存新增）。
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]), target);
    assert_eq!(git_ok(dir, &["status", "--porcelain"]), "A  b.txt");
    assert_eq!(
        std::fs::read_to_string(dir.join("b.txt")).expect("文件仍在"),
        "b\n"
    );
}

#[test]
fn mixed_reset_moves_branch_and_keeps_worktree_changes_unstaged() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let target = current_head(dir);
    commit(dir, "b.txt", "b\n", "c2");
    // c2 之后再写一个工作区改动：mixed 不得丢掉它。
    write_file(dir, "a.txt", "worktree\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = reset_request(&target, ResetMode::Mixed);
    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeResetMixed"));

    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]), target);
    // 索引被重置为空，工作区改动全部以未暂存 / 未跟踪形态保留。
    assert_eq!(git_ok(dir, &["diff", "--cached", "--name-only"]), "");
    assert_eq!(
        git_ok(dir, &["diff", "--name-only"]),
        "a.txt",
        "工作区改动必须保留"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("b.txt")).expect("文件仍在"),
        "b\n"
    );
    let status = module.workspace_status().expect("工作区状态");
    assert!(status.tracked > 0 && status.untracked > 0, "{status:?}");
    assert_eq!(status.staged, 0);
}

#[test]
fn hard_reset_discards_tracked_changes_with_warning_and_affected_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let target = current_head(dir);
    commit(dir, "b.txt", "b\n", "c2");
    write_file(dir, "a.txt", "dirty\n");
    write_file(dir, "untracked.txt", "keep\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = reset_request(&target, ResetMode::Hard);

    // Gate：破坏性 warning + 受影响路径（含未跟踪文件，明确不会被删除）。
    let gate = module.validate(&request).expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert!(warning_codes(&gate)
        .iter()
        .any(|code| code == "reset_hard_destructive"));
    assert_eq!(gate.affected_total, 2, "{gate:?}");
    assert!(gate.affected_paths.contains(&"a.txt".to_owned()));
    assert!(gate.affected_paths.contains(&"untracked.txt".to_owned()));
    let warning = gate
        .warnings
        .iter()
        .find(|warning| warning.code == "reset_hard_destructive")
        .expect("硬重置 warning");
    let args = warning.args.as_ref().expect("warning 参数");
    assert_eq!(args.get("total").map(String::as_str), Some("2"));
    assert_eq!(args.get("untracked").map(String::as_str), Some("1"));

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeResetHard"));

    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]), target);
    // 已跟踪改动被清除、c2 引入的文件被移除，未跟踪文件不受影响。
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).expect("文件仍在"),
        "base\n"
    );
    assert!(!dir.join("b.txt").exists(), "c2 引入的文件应被移除");
    assert_eq!(
        std::fs::read_to_string(dir.join("untracked.txt")).expect("未跟踪文件保留"),
        "keep\n"
    );
}

#[test]
fn reset_rejects_target_that_is_not_a_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    commit(dir, "b.txt", "b\n", "c2");
    // 树对象与不存在的 OID 都不是可重置的提交。
    let tree = git_ok(dir, &["rev-parse", "HEAD^{tree}"]);
    let missing = "0123456789abcdef0123456789abcdef01234567";

    let module = GitWriteModule::new(dir).expect("打开写模块");
    for oid in [tree.as_str(), missing] {
        let report = module
            .validate(&reset_request(oid, ResetMode::Mixed))
            .expect("Gate");
        assert!(!report.ok, "{oid} 不应通过");
        assert!(
            issue_codes(&report)
                .iter()
                .any(|code| code == "gate_reset_target_invalid"),
            "{:?}",
            report.issues
        );
    }

    // 缺模式：明确拒绝，不替用户猜 soft / mixed / hard。
    let mut request = reset_request(missing, ResetMode::Mixed);
    request.reset_mode = None;
    let report = module.validate(&request).expect("Gate");
    assert!(issue_codes(&report)
        .iter()
        .any(|code| code == "gate_reset_mode_required"));
}

#[test]
fn reset_rejects_unborn_head() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = reset_request("0123456789abcdef0123456789abcdef01234567", ResetMode::Mixed);
    let report = module.validate(&request).expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report)
        .iter()
        .any(|code| code == "gate_unborn_head"));
}

#[test]
fn reset_to_head_is_rejected_unless_it_still_has_work_to_do() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let head = commit(dir, "a.txt", "base\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    // 干净工作区：三种模式都没有可重置的内容。
    for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
        let report = module.validate(&reset_request(&head, mode)).expect("Gate");
        assert!(
            issue_codes(&report)
                .iter()
                .any(|code| code == "gate_reset_noop"),
            "{mode:?}: {:?}",
            report.issues
        );
    }

    // 有已暂存改动时，`reset --mixed HEAD` 等价于「全部取消暂存」，必须放行。
    write_file(dir, "a.txt", "staged\n");
    git_ok(dir, &["add", "a.txt"]);
    let report = module
        .validate(&reset_request(&head, ResetMode::Mixed))
        .expect("Gate");
    assert!(report.ok, "{:?}", report.issues);

    let outcome = module
        .execute(&reset_request(&head, ResetMode::Mixed))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(git_ok(dir, &["diff", "--cached", "--name-only"]), "");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).expect("文件仍在"),
        "staged\n"
    );
}

#[test]
fn reset_warns_when_target_is_behind_upstream() {
    let sandbox = remote_sandbox("write-reset-upstream");
    let local = sandbox.local();
    let first = current_head(local);
    // 把第二个提交推到 origin：origin/main 前移，`first` 变成「已推送但落后」的目标。
    commit(local, "b.txt", "b\n", "c2");
    git_ok(local, &["push", "origin", "main"]);
    let published = current_head(local);
    // 之后的本地提交尚未推送，重置到它不属于「丢弃已推送提交」。
    let unpushed = commit(local, "c.txt", "c\n", "c3");
    commit(local, "d.txt", "d\n", "c4");

    let module = GitWriteModule::new(local).expect("打开写模块");
    let behind = module
        .validate(&reset_request(&first, ResetMode::Mixed))
        .expect("Gate");
    assert!(behind.ok, "{:?}", behind.issues);
    assert!(
        warning_codes(&behind)
            .iter()
            .any(|code| code == "reset_diverges_upstream"),
        "{:?}",
        behind.warnings
    );
    let warning = behind
        .warnings
        .iter()
        .find(|warning| warning.code == "reset_diverges_upstream")
        .expect("分叉提示");
    assert_eq!(
        warning
            .args
            .as_ref()
            .and_then(|args| args.get("upstream"))
            .map(String::as_str),
        Some("origin/main")
    );

    // 目标在上游历史上、与上游同一提交时不提示；只落后上游时才提示。
    let at_upstream = module
        .validate(&reset_request(&published, ResetMode::Mixed))
        .expect("Gate");
    assert!(
        !warning_codes(&at_upstream)
            .iter()
            .any(|code| code == "reset_diverges_upstream"),
        "{:?}",
        at_upstream.warnings
    );

    // 未推送过的本地提交：重置到它不会丢弃任何已推送内容，不提示。
    let local_only = module
        .validate(&reset_request(&unpushed, ResetMode::Soft))
        .expect("Gate");
    assert!(local_only.ok, "{:?}", local_only.issues);
    assert!(
        !warning_codes(&local_only)
            .iter()
            .any(|code| code == "reset_diverges_upstream"),
        "{:?}",
        local_only.warnings
    );
}
