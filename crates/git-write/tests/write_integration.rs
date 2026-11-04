//! GitWriteModule 公开接口的行为验证：Gate、状态机与 CLI 结果判定。

use std::process::Command;

use git_core::{FileStatus, InterruptionKind, Oid, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use tempfile::TempDir;
use test_support::{commit, git_ok, init_temp_repo, write};

fn base_request(kind: WriteKind) -> WriteRequest {
    WriteRequest {
        kind,
        oid: None,
        branch: None,
        new_name: None,
        description: None,
        paths: None,
        interruption: None,
        mainline: None,
        message: None,
    }
}

fn request(
    kind: WriteKind,
    oid: Option<&str>,
    branch: Option<&str>,
    description: Option<&str>,
) -> WriteRequest {
    WriteRequest {
        oid: oid.map(|value| Oid::new(value).expect("oid")),
        branch: branch.map(str::to_owned),
        description: description.map(str::to_owned),
        ..base_request(kind)
    }
}

fn pick_request(kind: WriteKind, oid: &str, mainline: Option<u32>) -> WriteRequest {
    WriteRequest {
        oid: Some(Oid::new(oid).expect("oid")),
        mainline,
        ..base_request(kind)
    }
}

fn operation_request(kind: WriteKind, interruption: InterruptionKind) -> WriteRequest {
    WriteRequest {
        interruption: Some(interruption),
        ..base_request(kind)
    }
}

fn staging_request(kind: WriteKind, paths: &[&str]) -> WriteRequest {
    WriteRequest {
        paths: Some(paths.iter().map(|path| (*path).to_owned()).collect()),
        ..base_request(kind)
    }
}

fn conflict_repo() -> (TempDir, String) {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "conflict.txt", "a\nb\nc\n", "base");
    git_ok(dir, &["switch", "-c", "feature"]);
    let feature = commit(dir, "conflict.txt", "a\nfeature\nc\n", "feature 修改同一行");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "conflict.txt", "a\nmain\nc\n", "main 修改同一行");
    (temp, feature)
}

/// 构造 main + feature 的无冲突 merge commit；返回 (临时目录, merge, 第 1 父, 第 2 父)。
fn merge_repo() -> (TempDir, String, String, String) {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "base.txt", "base\n", "base");
    git_ok(dir, &["switch", "-c", "feature"]);
    let feature_tip = commit(dir, "feature.txt", "feature\n", "feature 分支");
    git_ok(dir, &["switch", "main"]);
    let main_tip = commit(dir, "main.txt", "main\n", "main 分支");
    git_ok(dir, &["merge", "--no-ff", "-m", "merge feature", "feature"]);
    let merge = git_ok(dir, &["rev-parse", "HEAD"]).trim().to_owned();
    (temp, merge, main_tip, feature_tip)
}

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
            InterruptionKind::Merge,
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
            .any(|issue| issue.code == "gate_sequenced_operation"),
        "{:?}",
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

#[test]
fn staging_status_separates_staged_and_unstaged() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    write(&dir.join("a.txt"), "two\n");
    write(&dir.join("b.txt"), "new\n");
    git_ok(dir, &["add", "b.txt"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "b.txt" && file.status == FileStatus::Added));
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "a.txt" && file.status == FileStatus::Modified));
    assert!(!status.staged.iter().any(|file| file.path == "a.txt"));
    let unstaged = status
        .unstaged
        .iter()
        .find(|file| file.path == "a.txt")
        .expect("未暂存条目");
    assert!(unstaged.additions > 0);
}

#[test]
fn stage_and_unstage_round_trip_preserves_content() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("u.txt"), "hello\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["u.txt"]))
        .expect("暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status.staged.iter().any(|file| file.path == "u.txt"));

    let diff = module
        .staging_file_diff("u.txt", true)
        .expect("staged diff");
    assert_eq!(diff.status, FileStatus::Added);
    assert!(diff.patch.as_deref().unwrap_or("").contains("+hello"));

    let outcome = module
        .execute(&staging_request(WriteKind::UnstageFiles, &["u.txt"]))
        .expect("取消暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "u.txt" && file.untracked));
    assert_eq!(
        std::fs::read_to_string(dir.join("u.txt")).expect("文件仍在"),
        "hello\n"
    );
}

#[test]
fn batch_stage_handles_deletion_and_new_file() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    std::fs::remove_file(dir.join("a.txt")).expect("删除工作区文件");
    write(&dir.join("new.txt"), "new\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&staging_request(
            WriteKind::StageFiles,
            &["a.txt", "new.txt"],
        ))
        .expect("批量暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "a.txt" && file.status == FileStatus::Deleted));
    assert!(status
        .staged
        .iter()
        .any(|file| file.path == "new.txt" && file.status == FileStatus::Added));
}

#[test]
fn staged_rename_diff_uses_old_and_new_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "old.txt", "same\ncontent\n", "base");
    git_ok(dir, &["mv", "old.txt", "new.txt"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let status = module.staging_status().expect("暂存区状态");
    let entry = status
        .staged
        .iter()
        .find(|file| file.path == "new.txt")
        .expect("重命名条目");
    assert_eq!(entry.status, FileStatus::Renamed);
    assert_eq!(entry.old_path.as_deref(), Some("old.txt"));

    let diff = module
        .staging_file_diff("new.txt", true)
        .expect("staged diff");
    let patch = diff.patch.as_deref().unwrap_or("");
    assert!(patch.contains("rename from old.txt"), "{patch}");
}

#[test]
fn unstage_on_unborn_head_keeps_untracked_file() {
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("first.txt"), "first\n");
    git_ok(dir, &["add", "first.txt"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let status = module.staging_status().expect("暂存区状态");
    assert!(status.unborn);
    assert!(status.staged.iter().any(|file| file.path == "first.txt"));

    let outcome = module
        .execute(&staging_request(WriteKind::UnstageFiles, &["first.txt"]))
        .expect("取消暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "first.txt" && file.untracked));
    assert!(dir.join("first.txt").exists());
}

#[test]
fn staging_rejects_invalid_and_unknown_paths() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    for path in ["../outside.txt", "C:/outside.txt", "missing.txt"] {
        let outcome = module
            .execute(&staging_request(WriteKind::StageFiles, &[path]))
            .expect("Gate");
        assert_eq!(outcome.status, WriteStatus::Rejected, "{path}: {outcome:?}");
    }
}

#[test]
fn conflicted_files_are_listed_and_excluded_from_groups() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Conflicted);

    let status = module.staging_status().expect("暂存区状态");
    assert!(status
        .conflicted_files
        .iter()
        .any(|file| file == "conflict.txt"));
    assert!(!status.staged.iter().any(|file| file.path == "conflict.txt"));
    assert!(!status
        .unstaged
        .iter()
        .any(|file| file.path == "conflict.txt"));

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["conflict.txt"]))
        .expect("Gate");
    assert_eq!(outcome.status, WriteStatus::Rejected);
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

#[test]
fn switch_requires_existing_local_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git_ok(dir, &["branch", "topic"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let missing = module
        .validate(&request(
            WriteKind::SwitchBranch,
            None,
            Some("remotenothere"),
            None,
        ))
        .expect("Gate");
    assert!(!missing.ok);
    assert!(missing
        .issues
        .iter()
        .any(|issue| issue.code == "gate_branch_not_found"));

    let current = module
        .validate(&request(WriteKind::SwitchBranch, None, Some("main"), None))
        .expect("Gate");
    assert!(current
        .issues
        .iter()
        .any(|issue| issue.code == "gate_already_on_branch"));

    let outcome = module
        .execute(&request(WriteKind::SwitchBranch, None, Some("topic"), None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );
}

#[test]
fn branch_description_roundtrip_uses_local_config() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&request(
            WriteKind::SetBranchDescription,
            None,
            Some("main"),
            Some("主线说明"),
        ))
        .expect("写入描述");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");

    let read = module.read_branch_description("main").expect("读取描述");
    assert_eq!(read.description, "主线说明");
    assert_eq!(
        git_ok(
            dir,
            &["config", "--local", "--get", "branch.main.description"]
        )
        .trim(),
        "主线说明"
    );
    assert!(!read.shared_across_worktrees);

    let cleared = module
        .execute(&request(
            WriteKind::SetBranchDescription,
            None,
            Some("main"),
            Some("  "),
        ))
        .expect("清空描述");
    assert_eq!(cleared.status, WriteStatus::Succeeded, "{cleared:?}");
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        ""
    );
}

#[test]
fn switch_rejects_worktree_occupied_branch() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git_ok(dir, &["branch", "occupied"]);
    let linked = temp.path().join("linked");
    git_ok(
        dir,
        &[
            "worktree",
            "add",
            linked.to_str().expect("UTF-8 路径"),
            "occupied",
        ],
    );

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(
            WriteKind::SwitchBranch,
            None,
            Some("occupied"),
            None,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_branch_checked_out"));
}

#[test]
fn switch_carries_dirty_changes_with_warning() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "tracked.txt", "base\n", "base");
    git_ok(dir, &["branch", "topic"]);
    write(&dir.join("staged.txt"), "staged\n");
    git_ok(dir, &["add", "staged.txt"]);
    write(&dir.join("tracked.txt"), "base\nlocal\n");
    write(&dir.join("new.txt"), "new\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(WriteKind::SwitchBranch, None, Some("topic"), None);
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "dirty 切换应在确认后允许：{:?}", report.issues);
    assert!(report.issues.is_empty());
    assert!(report
        .warnings
        .iter()
        .any(|warning| warning.code == "worktree_dirty"));
    assert_eq!(report.affected_total, 3);
    let mut paths = report.affected_paths.clone();
    paths.sort();
    assert_eq!(paths, vec!["new.txt", "staged.txt", "tracked.txt"]);
    assert!(report.summary.contains("3 个有改动的文件"));

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(
        outcome.message.contains("改动已保留"),
        "{}",
        outcome.message
    );
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("tracked.txt")).expect("读取文件"),
        "base\nlocal\n"
    );
    let status = git_ok(dir, &["status", "--porcelain=v2"]);
    assert!(status.contains("1 A. "), "{status}");
    assert!(status.contains("1 .M "), "{status}");
    assert!(status.contains("? new.txt"), "{status}");
}

#[test]
fn switch_overwrite_failure_preserves_dirty_changes() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "shared.txt", "base\n", "base");
    git_ok(dir, &["switch", "-c", "topic"]);
    commit(dir, "shared.txt", "topic\n", "topic 修改");
    git_ok(dir, &["switch", "main"]);
    write(&dir.join("shared.txt"), "local\n");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(WriteKind::SwitchBranch, None, Some("topic"), None);
    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "覆盖风险由 Git 判定：{:?}", report.issues);
    assert_eq!(report.affected_paths, vec!["shared.txt".to_owned()]);

    let outcome = module.execute(&request).expect("执行");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert!(
        outcome
            .stderr
            .as_deref()
            .unwrap_or("")
            .contains("would be overwritten"),
        "stderr：{:?}",
        outcome.stderr
    );
    assert_eq!(
        git_ok(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "main"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("shared.txt")).expect("读取文件"),
        "local\n"
    );
    assert!(git_ok(dir, &["status", "--porcelain=v2"]).contains("1 .M "));
}

#[test]
fn switch_rejects_unmerged_index_without_operation_marker() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "f.txt", "a\nb\nc\n", "base");
    git_ok(dir, &["switch", "-c", "topic"]);
    commit(dir, "f.txt", "a\ntopic\nc\n", "topic 修改");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "f.txt", "a\nmain\nc\n", "main 修改");
    let merge = Command::new("git")
        .current_dir(dir)
        .args(["merge", "topic"])
        .output()
        .expect("启动 git merge");
    assert!(!merge.status.success(), "merge 应产生冲突");
    // 模拟没有操作标记但索引仍未合并的残留状态。
    std::fs::remove_file(dir.join(".git").join("MERGE_HEAD")).expect("删除 MERGE_HEAD");

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(WriteKind::SwitchBranch, None, Some("topic"), None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "gate_conflicted_index_switch"));
}
#[test]
fn valid_description_is_written_after_gate_validation() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("集成与发布主线"),
    );

    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    let outcome = module.execute(&request).expect("写入描述");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        "集成与发布主线"
    );
}

#[test]
fn rejects_description_starting_with_dash() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("--list"),
    );

    let error = module.validate(&request).expect_err("以 - 开头应被拒绝");
    assert!(
        error.message.contains("选项"),
        "错误消息应提示选项注入风险：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("选项"), "{}", error.message);
    // 值未被写入本地配置。
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        ""
    );
}

#[test]
fn rejects_description_with_control_characters() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("第一行\n第二行"),
    );

    let error = module.validate(&request).expect_err("含换行应被拒绝");
    assert!(
        error.message.contains("控制字符"),
        "错误消息应说明控制字符限制：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("控制字符"), "{}", error.message);
}

#[test]
fn rejects_overlong_description() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let overlong = "长".repeat(201);
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some(&overlong),
    );

    let error = module.validate(&request).expect_err("超长描述应被拒绝");
    assert!(
        error.message.contains("200"),
        "错误消息应包含长度上限：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("200"), "{}", error.message);
}
