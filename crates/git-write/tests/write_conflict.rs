//! 轻量冲突解决辅助（ADR-0033）：`checkout --ours/--theirs` 与 `git add` 标记已解决。

mod common;

use common::*;
use git_core::{WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

fn path_request(kind: WriteKind, path: &str) -> WriteRequest {
    WriteRequest {
        path: Some(path.to_owned()),
        ..base_request(kind)
    }
}

fn read(dir: &std::path::Path, path: &str) -> String {
    std::fs::read_to_string(dir.join(path)).expect("读取文件")
}

/// main 与 feature 同时改 conflict.txt 第 2 行，在 main 上 merge 得到真实冲突：
/// ours = `main`，theirs = `feature`。
fn conflicted_merge() -> (tempfile::TempDir, GitWriteModule) {
    let (temp, _feature) = conflict_repo();
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");
    let merged = module
        .execute(&request(WriteKind::Merge, None, Some("feature"), None))
        .expect("merge");
    assert_eq!(merged.status, WriteStatus::Conflicted, "{merged:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert_eq!(status.conflicted_files, vec!["conflict.txt".to_owned()]);
    (temp, module)
}

#[test]
fn ours_overwrites_worktree_then_mark_resolves() {
    let (temp, module) = conflicted_merge();
    let dir = temp.path();

    // 冲突解决不受「存在未完成操作即拒绝」约束（ADR-0033）：merge 未收尾时必须可用。
    let gate = module
        .validate(&path_request(
            WriteKind::ResolveConflictOurs,
            "conflict.txt",
        ))
        .expect("Gate");
    assert!(gate.ok, "{gate:?}");
    assert_eq!(gate.affected_paths, vec!["conflict.txt".to_owned()]);
    // 摘要不声称哪一侧是「当前分支」：rebase 下 ours/theirs 会反转。
    assert!(!gate.summary.contains("当前分支"), "{}", gate.summary);

    let outcome = module
        .execute(&path_request(
            WriteKind::ResolveConflictOurs,
            "conflict.txt",
        ))
        .expect("采用 ours");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        outcome.key.as_deref(),
        Some("errors.resolveConflictOursDone")
    );
    assert_eq!(read(dir, "conflict.txt"), "a\nmain\nc\n");

    // checkout 不动索引：冲突仍在，必须显式 mark 才真正收尾。
    let status = module.staging_status().expect("暂存区状态");
    assert_eq!(status.conflicted_files, vec!["conflict.txt".to_owned()]);

    let marked = module
        .execute(&path_request(
            WriteKind::MarkConflictResolved,
            "conflict.txt",
        ))
        .expect("标记已解决");
    assert_eq!(marked.status, WriteStatus::Succeeded, "{marked:?}");
    assert_eq!(
        marked.key.as_deref(),
        Some("errors.markConflictResolvedDone")
    );

    let status = module.staging_status().expect("暂存区状态");
    assert!(status.conflicted_files.is_empty(), "{status:?}");
    assert_eq!(git_ok(dir, &["show", ":conflict.txt"]), "a\nmain\nc");
    // 解决后的内容与 HEAD 相同：索引回到 HEAD，暂存区没有新改动。
    assert!(status.staged.is_empty(), "{status:?}");
}

#[test]
fn theirs_overwrites_worktree_then_mark_resolves() {
    let (temp, module) = conflicted_merge();
    let dir = temp.path();

    let outcome = module
        .execute(&path_request(
            WriteKind::ResolveConflictTheirs,
            "conflict.txt",
        ))
        .expect("采用 theirs");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        outcome.key.as_deref(),
        Some("errors.resolveConflictTheirsDone")
    );
    assert_eq!(read(dir, "conflict.txt"), "a\nfeature\nc\n");

    let marked = module
        .execute(&path_request(
            WriteKind::MarkConflictResolved,
            "conflict.txt",
        ))
        .expect("标记已解决");
    assert_eq!(marked.status, WriteStatus::Succeeded, "{marked:?}");

    let status = module.staging_status().expect("暂存区状态");
    assert!(status.conflicted_files.is_empty(), "{status:?}");
    assert_eq!(git_ok(dir, &["show", ":conflict.txt"]), "a\nfeature\nc");
    // theirs 与 HEAD 不同：解决后该文件以「已暂存改动」进入索引。
    assert!(status.staged.iter().any(|file| file.path == "conflict.txt"));
}

#[test]
fn mark_warns_when_markers_remain_but_gate_stays_ok() {
    let (temp, module) = conflicted_merge();
    let dir = temp.path();
    assert!(read(dir, "conflict.txt").contains("<<<<<<<"));

    let gate = module
        .validate(&path_request(
            WriteKind::MarkConflictResolved,
            "conflict.txt",
        ))
        .expect("Gate");
    assert!(gate.ok, "warning 不得阻断：{gate:?}");
    let warning = gate
        .warnings
        .iter()
        .find(|warning| warning.code == "conflict_markers_present")
        .expect("应报告残留冲突标记");
    assert_eq!(
        warning
            .args
            .as_ref()
            .and_then(|args| args.get("path"))
            .map(String::as_str),
        Some("conflict.txt")
    );
    assert_eq!(gate.affected_total, 1);

    // 覆盖成 ours 后工作区不再有标记；冲突状态仍在，此时不应再告警。
    module
        .execute(&path_request(
            WriteKind::ResolveConflictOurs,
            "conflict.txt",
        ))
        .expect("采用 ours");
    let gate = module
        .validate(&path_request(
            WriteKind::MarkConflictResolved,
            "conflict.txt",
        ))
        .expect("Gate");
    assert!(gate.ok, "{gate:?}");
    assert!(
        gate.warnings
            .iter()
            .all(|warning| warning.code != "conflict_markers_present"),
        "{gate:?}"
    );
}

#[test]
fn rejects_non_conflicted_missing_and_invalid_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("a.txt"), "dirty\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    // 非冲突路径：三种动作都在 Gate 阶段拒绝。
    for kind in [
        WriteKind::ResolveConflictOurs,
        WriteKind::ResolveConflictTheirs,
        WriteKind::MarkConflictResolved,
    ] {
        let gate = module.validate(&path_request(kind, "a.txt")).expect("Gate");
        assert!(!gate.ok, "{kind:?}");
        assert_eq!(
            gate.issues.first().map(|issue| issue.code.as_str()),
            Some("gate_conflict_path_not_conflicted"),
            "{kind:?}"
        );
    }

    // 缺少 path。
    let gate = module
        .validate(&base_request(WriteKind::MarkConflictResolved))
        .expect("Gate");
    assert_eq!(
        gate.issues.first().map(|issue| issue.code.as_str()),
        Some("gate_conflict_path_required")
    );

    // 非法路径形态一律拒绝。
    for path in [
        "../outside.txt",
        "C:/outside.txt",
        "-rf",
        ".git/config",
        "a\nb.txt",
    ] {
        let outcome = module
            .execute(&path_request(WriteKind::ResolveConflictOurs, path))
            .expect("Gate");
        assert_eq!(outcome.status, WriteStatus::Rejected, "{path}: {outcome:?}");
    }

    // 拒绝后工作区零改动。
    assert_eq!(read(dir, "a.txt"), "dirty\n");
}
