//! 提交创建与 amend 的行为验证：Gate 规则、执行结果、reflog 与临时消息文件清理。

use std::path::PathBuf;
use std::time::Duration;

use git_core::{GateReportDto, WriteKind, WriteRequest, WriteStatus};
use test_support::{commit, current_head, git_ok, init_temp_repo, write};

use crate::GitWriteModule;

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
        stash: None,
        include_untracked: None,
        pull_mode: None,
        oids: None,
    }
}

fn commit_request(kind: WriteKind, message: &str) -> WriteRequest {
    WriteRequest {
        message: Some(message.to_owned()),
        ..base_request(kind)
    }
}

fn issue_codes(report: &GateReportDto) -> Vec<&str> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect()
}

/// 构造 cherry-pick 冲突中断态仓库（含未解决冲突索引）。
fn conflicted_repo() -> tempfile::TempDir {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "conflict.txt", "a\nb\nc\n", "base");
    git_ok(dir, &["switch", "-c", "feature"]);
    let feature = commit(dir, "conflict.txt", "a\nfeature\nc\n", "feature 修改同一行");
    git_ok(dir, &["switch", "main"]);
    commit(dir, "conflict.txt", "a\nmain\nc\n", "main 修改同一行");
    let pick = std::process::Command::new("git")
        .current_dir(dir)
        .args(["cherry-pick", &feature])
        .output()
        .expect("启动 git cherry-pick");
    assert!(!pick.status.success(), "应产生冲突");
    temp
}

fn leftover_message_files() -> Vec<PathBuf> {
    let prefix = format!("gitdock-commit-{}", std::process::id());
    std::fs::read_dir(std::env::temp_dir())
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(&prefix))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// execute 内同步创建并删除临时文件；残留即异常。并行测试的在途文件窗口极短，
/// 轮询重试避免把其它测试的瞬时文件误判为残留。
fn assert_no_leftover_message_files() {
    for _ in 0..10 {
        if leftover_message_files().is_empty() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let leftover = leftover_message_files();
    assert!(leftover.is_empty(), "临时消息文件残留: {leftover:?}");
}

#[test]
fn unborn_first_commit_succeeds_with_staged_files() {
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("a.txt"), "one\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&commit_request(WriteKind::CreateCommit, "首次提交"))
        .expect("Gate");
    assert!(gate.ok, "{:?}", gate.issues);
    assert_eq!(
        gate.summary_key.as_deref(),
        Some("errors.gateSummaryCommit")
    );

    let outcome = module
        .execute(&commit_request(WriteKind::CreateCommit, "首次提交"))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert!(outcome.head_oid.is_some());
    // 独立核对：消息与文件内容。
    assert_eq!(
        git_ok(dir, &["log", "-1", "--pretty=%B"]).trim_end(),
        "首次提交"
    );
    assert_eq!(git_ok(dir, &["show", "HEAD:a.txt"]).trim_end(), "one");
    assert_eq!(git_ok(dir, &["rev-list", "--count", "HEAD"]), "1");
    assert_no_leftover_message_files();
}

#[test]
fn multiline_message_with_dash_and_quotes_round_trips() {
    // --file 方案的核心收益：换行保真、引号与 `-` 开头行无注入风险。
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("a.txt"), "one\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let message = "标题行\n\n- 以短横开头的正文行\n含 \"引号\" 的行";

    let outcome = module
        .execute(&commit_request(WriteKind::CreateCommit, message))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(dir, &["log", "-1", "--pretty=%B"]).trim_end(),
        message
    );
}

#[test]
fn gate_rejects_create_with_empty_index() {
    let temp = init_temp_repo();
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");

    let report = module
        .validate(&commit_request(WriteKind::CreateCommit, "消息"))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_nothing_to_commit"));
}

#[test]
fn gate_rejects_blank_message_for_create_and_amend() {
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("a.txt"), "one\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&commit_request(WriteKind::CreateCommit, "   "))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_empty_message"));

    commit(dir, "a.txt", "one\n", "c1");
    let report = module
        .validate(&commit_request(WriteKind::AmendCommit, ""))
        .expect("Gate");
    assert!(issue_codes(&report).contains(&"gate_empty_message"));
}

#[test]
fn gate_rejects_create_during_interruption_and_conflict() {
    let temp = conflicted_repo();
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");

    let report = module
        .validate(&commit_request(WriteKind::CreateCommit, "消息"))
        .expect("Gate");
    let codes = issue_codes(&report);
    assert!(codes.contains(&"gate_interrupted"), "{codes:?}");
    assert!(codes.contains(&"gate_conflicted_index_commit"), "{codes:?}");
}

#[test]
fn gate_rejects_amend_on_unborn_head() {
    let temp = init_temp_repo();
    let module = GitWriteModule::new(temp.path()).expect("打开写模块");

    let report = module
        .validate(&commit_request(WriteKind::AmendCommit, "消息"))
        .expect("Gate");
    assert!(!report.ok);
    assert!(issue_codes(&report).contains(&"gate_unborn_head_amend"));
}

#[test]
fn amend_gate_summary_shows_replaced_head() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "主题文本");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let report = module
        .validate(&commit_request(WriteKind::AmendCommit, "新消息"))
        .expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    assert_eq!(
        report.summary_key.as_deref(),
        Some("errors.gateSummaryAmend")
    );
    let args = report.summary_args.expect("amend 摘要参数");
    let oid = args.get("oid").expect("oid 参数");
    assert!(current_head(dir).starts_with(oid), "{oid}");
    assert_eq!(args.get("subject").expect("subject 参数"), "主题文本");
}

#[test]
fn amend_message_only_keeps_tree_updates_committer_and_reflog() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "原消息");
    let old_head = current_head(dir);
    let old_tree_rev = format!("{old_head}^{{tree}}");
    let old_tree = git_ok(dir, &["rev-parse", &old_tree_rev]);
    let old_author = git_ok(dir, &["log", "-1", "--pretty=%an|%ae|%aI"]);
    let old_committer = git_ok(dir, &["log", "-1", "--pretty=%cI"]);
    // committer 时间戳为秒级精度，跨秒才能观测到更新。
    std::thread::sleep(Duration::from_secs(1));

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&commit_request(WriteKind::AmendCommit, "新消息"))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");

    let new_head = current_head(dir);
    assert_ne!(new_head, old_head);
    // 树内容不变。
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD^{tree}"]), old_tree);
    assert_eq!(
        git_ok(dir, &["log", "-1", "--pretty=%B"]).trim_end(),
        "新消息"
    );
    // author 不变、committer 更新（Git 默认语义，不传 --reset-author）。
    assert_eq!(
        git_ok(dir, &["log", "-1", "--pretty=%an|%ae|%aI"]),
        old_author
    );
    assert_ne!(git_ok(dir, &["log", "-1", "--pretty=%cI"]), old_committer);
    // 旧提交可经 reflog 找回。
    assert_eq!(git_ok(dir, &["rev-parse", "HEAD@{1}"]), old_head);
    assert_no_leftover_message_files();
}

#[test]
fn amend_with_staged_changes_updates_tree_and_message() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "原消息");
    write(&dir.join("a.txt"), "two\n");
    write(&dir.join("b.txt"), "new\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&commit_request(WriteKind::AmendCommit, "改后消息"))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git_ok(dir, &["log", "-1", "--pretty=%B"]).trim_end(),
        "改后消息"
    );
    assert_eq!(git_ok(dir, &["show", "HEAD:a.txt"]).trim_end(), "two");
    assert_eq!(git_ok(dir, &["show", "HEAD:b.txt"]).trim_end(), "new");
    assert_eq!(git_ok(dir, &["rev-list", "--count", "HEAD"]), "1");
    assert_no_leftover_message_files();
}

#[test]
fn pre_commit_hook_failure_keeps_head_and_surfaces_stderr() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    let head_before = current_head(dir);
    let hook = dir.join(".git").join("hooks").join("pre-commit");
    write(&hook, "#!/bin/sh\necho 'hook 拒绝提交' >&2\nexit 1\n");
    // fs::write 在 Linux 上默认 644，Git 会静默跳过无执行位的 hook，测试就失去了
    // 「hook 拒绝提交」的前提；Windows 无 POSIX 权限位（Git for Windows 视普通文件
    // 为可执行），只需在 Unix 上补 0o755。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
            .expect("设置 hook 执行位");
    }
    write(&dir.join("a.txt"), "two\n");
    git_ok(dir, &["add", "-A"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&commit_request(WriteKind::CreateCommit, "被拒提交"))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Failed, "{outcome:?}");
    assert!(
        outcome
            .stderr
            .as_deref()
            .unwrap_or_default()
            .contains("hook 拒绝提交"),
        "stderr 应透传 hook 输出: {:?}",
        outcome.stderr
    );
    assert_eq!(current_head(dir), head_before);
    // 失败路径同样要清理临时消息文件。
    assert_no_leftover_message_files();
}
