//! 冲突中断后的继续 / 中止流程：Gate 拒绝条件、收尾与空结果处理。

mod common;

use std::process::Command;

use common::*;
use git_core::{InterruptionKind, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

#[test]
fn continue_gate_requires_matching_interruption() {
    let temp = init_temp_repo();
    let dir = temp.path();
    let target = commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let missing_kind = module
        .validate(&base_request(WriteKind::ContinueOperation))
        .expect("Gate");
    assert!(!missing_kind.ok);
    assert!(missing_kind
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_required"));

    let invalid = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::Sequencer,
        ))
        .expect("Gate");
    assert!(!invalid.ok);
    assert!(invalid
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_invalid"));

    // 无标记时由 Gate 拒绝，不把用户请求交给 git。
    let no_marker = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!no_marker.ok);
    assert!(no_marker
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_marker_absent"));

    // 非继续/中止操作不得携带 interruption，避免静默忽略。
    let not_applicable = module
        .validate(&WriteRequest {
            interruption: Some(InterruptionKind::CherryPick),
            ..request(WriteKind::CherryPick, Some(&target), None, None)
        })
        .expect("Gate");
    assert!(!not_applicable.ok);
    assert!(not_applicable
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_not_applicable"));
}

#[test]
fn continue_gate_accepts_externally_started_single_pick() {
    // Q3：终端发起、无 sequencer 的单次 cherry-pick 冲突也允许应用内继续。
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let pick = Command::new("git")
        .current_dir(dir)
        .args(["cherry-pick", &feature])
        .output()
        .expect("启动 git cherry-pick");
    assert!(!pick.status.success(), "应产生冲突");
    assert!(dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert!(!dir.join(".git").join("sequencer").exists());

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    // 唯一拒绝原因应是未解决冲突，而不是来源或标记不匹配。
    assert!(!report.ok);
    assert!(
        report
            .issues
            .iter()
            .all(|issue| issue.code == "gate_unresolved_conflicts"),
        "{:?}",
        report.issues
    );
}

#[test]
fn continue_gate_rejects_marker_of_other_kind() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&request(WriteKind::Revert, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    assert!(dir.join(".git").join("REVERT_HEAD").exists());

    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_mismatch"));
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.message.contains("REVERT_HEAD")));

    let abort = module
        .validate(&operation_request(
            WriteKind::AbortOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!abort.ok);
    assert!(abort
        .issues
        .iter()
        .any(|issue| issue.code == "gate_interruption_mismatch"));
}

#[test]
fn continue_gate_rejects_sequencer_and_index_lock() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");

    let sequencer = dir.join(".git").join("sequencer");
    std::fs::create_dir_all(&sequencer).expect("创建 sequencer");
    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "gate_unresolved_conflicts"),
        "{:?}",
        report.issues
    );
    assert!(
        report
            .issues
            .iter()
            .all(|issue| issue.code != "gate_sequenced_operation"),
        "sequences are now handled in-app: {:?}",
        report.issues
    );
    std::fs::remove_dir_all(&sequencer).expect("删除 sequencer");

    let index_lock = dir.join(".git").join("index.lock");
    std::fs::write(&index_lock, b"").expect("创建 index.lock");
    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.code == "gate_index_locked"),
        "{:?}",
        report.issues
    );
    std::fs::remove_file(&index_lock).expect("删除 index.lock");
}

#[test]
fn continue_gate_rejects_unresolved_conflicts_without_running_git() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    let head_before = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();

    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(!report.ok);
    let issue = report
        .issues
        .iter()
        .find(|issue| issue.code == "gate_unresolved_conflicts")
        .expect("应拒绝未解决冲突");
    assert!(issue.message.contains("git add"), "{}", issue.message);

    // Gate 不得执行任何收尾命令：标记仍在、HEAD 未变。
    assert!(dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]).trim(), head_before);
}

#[test]
fn continue_after_resolving_conflict_completes_pick() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    let head_before = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();

    write(&dir.join("conflict.txt"), "a\nresolved\nc\n");
    git_ok(dir, &["add", "conflict.txt"]);

    let report = module
        .validate(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(report.ok, "解决冲突后应通过：{:?}", report.issues);

    let outcome = module
        .execute(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert_ne!(git_ok(dir, &["rev-parse", "HEAD"]).trim(), head_before);
    assert_eq!(
        git_ok(dir, &["log", "-1", "--format=%s"]).trim(),
        "feature 修改同一行"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("conflict.txt")).expect("读取文件"),
        "a\nresolved\nc\n"
    );
    assert!(!module.inspect_interruption().expect("探测中断").is_active());
}

#[test]
fn abort_after_conflict_restores_pre_pick_state() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let pre_head = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();
    let pre_content = std::fs::read_to_string(dir.join("conflict.txt")).expect("读取文件");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");

    // 中止必须允许未解决冲突（它将丢弃工作区状态）。
    let report = module
        .validate(&operation_request(
            WriteKind::AbortOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("Gate");
    assert!(report.ok, "中止应允许冲突存在：{:?}", report.issues);

    let outcome = module
        .execute(&operation_request(
            WriteKind::AbortOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(!dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]).trim(), pre_head);
    let content = std::fs::read_to_string(dir.join("conflict.txt")).expect("读取文件");
    // Windows 上 checkout 会按 autocrlf 改写行尾，比较前统一换行符。
    assert_eq!(
        content.replace("\r\n", "\n"),
        pre_content.replace("\r\n", "\n")
    );
    assert!(!content.contains("<<<<<<<"), "{content}");
    assert_eq!(git_ok(dir, &["status", "--porcelain=v2"]).trim(), "");
    assert!(!module.inspect_interruption().expect("探测中断").is_active());
}

#[test]
fn continue_empty_result_fails_with_skip_hint() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted, "{outcome:?}");
    let head_before = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();

    // 解决为与 HEAD 完全相同的内容：继续后 Git 判定为空提交。
    write(&dir.join("conflict.txt"), "a\nmain\nc\n");
    git_ok(dir, &["add", "conflict.txt"]);

    let outcome = module
        .execute(&operation_request(
            WriteKind::ContinueOperation,
            InterruptionKind::CherryPick,
        ))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert!(dir.join(".git").join("CHERRY_PICK_HEAD").exists());
    assert!(
        outcome.message.contains("git cherry-pick --skip"),
        "{}",
        outcome.message
    );
    assert!(
        outcome.message.contains("git revert --skip"),
        "{}",
        outcome.message
    );
    // 绝不自动 skip：HEAD 保持不变。
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD"]).trim(), head_before);
}
