//! Worktree 管理（ADR-0034）：porcelain 列表、创建/移除的 Gate 与执行、提交模板读取。
//!
//! 全部在临时仓库里跑真实 Git：列表来自 `git worktree list --porcelain`，
//! 写操作走 Gate + 参数数组执行，绝不使用 `--force`。

mod common;

use std::path::{Path, PathBuf};

use common::*;
use git_core::{GateReportDto, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

fn module(path: &Path) -> GitWriteModule {
    GitWriteModule::new(path).expect("打开夹具仓库")
}

fn issue_codes(report: &GateReportDto) -> Vec<String> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.clone())
        .collect()
}

fn create_request(path: &Path, branch: &str) -> WriteRequest {
    WriteRequest {
        path: Some(normalize(path)),
        branch: Some(branch.to_owned()),
        ..base_request(WriteKind::CreateWorktree)
    }
}

fn remove_request(path: &str) -> WriteRequest {
    WriteRequest {
        path: Some(path.to_owned()),
        ..base_request(WriteKind::RemoveWorktree)
    }
}

/// Git 在 Windows 上报告正斜杠路径，比较前统一分隔符。
fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn repo_with_branch(prefix: &str) -> (tempfile::TempDir, PathBuf, String) {
    let temp = init_temp_repo();
    let dir = temp.path().to_path_buf();
    commit(&dir, "a.txt", "base\n", "c1");
    git_ok(&dir, &["branch", "feat"]);
    let target = temp.path().join(format!("wt-{prefix}"));
    (temp, dir, normalize(&target))
}

#[test]
fn list_worktrees_reports_main_and_linked_entries() {
    let (_temp, dir, target) = repo_with_branch("list");
    git_ok(&dir, &["worktree", "add", &target, "feat"]);
    let module = module(&dir);
    let entries = module.list_worktrees().expect("列出 worktree");
    assert_eq!(entries.len(), 2, "{entries:?}");

    let main = &entries[0];
    assert!(main.is_main);
    assert!(!main.detached);
    assert_eq!(main.branch.as_deref(), Some("main"));
    assert_eq!(normalize(Path::new(&main.path)), normalize(&dir));

    let linked = &entries[1];
    assert!(!linked.is_main);
    assert_eq!(linked.branch.as_deref(), Some("feat"));
    assert!(linked.head_oid.is_some());
    assert_eq!(linked.path, target);
}

#[test]
fn create_worktree_executes_and_is_listed() {
    let (_temp, dir, target) = repo_with_branch("create");
    let module = module(&dir);
    let request = create_request(Path::new(&target), "feat");

    let report = module.validate(&request).expect("create Gate");
    assert!(report.ok, "{:?}", issue_codes(&report));
    assert!(report.summary.contains(&target), "{}", report.summary);

    let outcome = module.execute(&request).expect("执行 create");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.worktreeCreated"));
    assert!(Path::new(&target).join("a.txt").is_file());

    let entries = module.list_worktrees().expect("列出 worktree");
    let created = entries
        .iter()
        .find(|entry| entry.path == target)
        .expect("新 worktree 应在列表中");
    assert_eq!(created.branch.as_deref(), Some("feat"));
    assert!(!created.is_main);
}

#[test]
fn create_gate_rejects_occupied_branch_relative_path_and_bad_targets() {
    let (temp, dir, target) = repo_with_branch("gate");
    let module = module(&dir);

    // 分支被主 worktree 检出（含主 worktree 的占用者判定）。
    let occupied = module
        .validate(&create_request(Path::new(&target), "main"))
        .expect("create Gate");
    assert!(!occupied.ok);
    assert!(issue_codes(&occupied).contains(&"gate_branch_checked_out".to_owned()));

    // 分支不存在。
    let missing = module
        .validate(&create_request(Path::new(&target), "no-such-branch"))
        .expect("create Gate");
    assert!(issue_codes(&missing).contains(&"gate_branch_not_found".to_owned()));

    // 相对路径。
    let relative = WriteRequest {
        path: Some("relative/wt".to_owned()),
        branch: Some("feat".to_owned()),
        ..base_request(WriteKind::CreateWorktree)
    };
    assert!(
        issue_codes(&module.validate(&relative).expect("create Gate"))
            .contains(&"gate_worktree_path_invalid".to_owned())
    );

    // 目标目录非空。
    let non_empty = temp.path().join("non-empty");
    std::fs::create_dir_all(&non_empty).expect("创建目录");
    write(&non_empty.join("x.txt"), "x\n");
    let occupied_target = module
        .validate(&create_request(&non_empty, "feat"))
        .expect("create Gate");
    assert!(issue_codes(&occupied_target).contains(&"gate_worktree_target_not_empty".to_owned()));

    // 父目录不存在。
    let missing_parent = temp.path().join("missing").join("wt");
    let no_parent = module
        .validate(&create_request(&missing_parent, "feat"))
        .expect("create Gate");
    assert!(issue_codes(&no_parent).contains(&"gate_worktree_parent_missing".to_owned()));
}

#[test]
fn create_gate_rejects_unborn_head() {
    let temp = init_temp_repo();
    let module = module(temp.path());
    let target = temp.path().join("wt");
    let report = module
        .validate(&create_request(&target, "feat"))
        .expect("create Gate");
    let codes = issue_codes(&report);
    assert!(codes.contains(&"gate_unborn_head".to_owned()), "{codes:?}");
}

#[test]
fn remove_gate_rejects_main_locked_and_dirty_then_removes_clean_entry() {
    let (temp, dir, target) = repo_with_branch("remove");
    git_ok(&dir, &["worktree", "add", &target, "feat"]);
    let module = module(&dir);

    // 主 worktree 不可移除。
    let main = module
        .validate(&remove_request(&normalize(&dir)))
        .expect("remove Gate");
    assert!(issue_codes(&main).contains(&"gate_worktree_is_main".to_owned()));

    // 未在列表中（绝对路径但不在 worktree 清单里）。
    let unlisted = normalize(&temp.path().join("not-listed"));
    let unknown = module
        .validate(&remove_request(&unlisted))
        .expect("remove Gate");
    assert!(issue_codes(&unknown).contains(&"gate_worktree_not_found".to_owned()));

    // locked 条目。
    git_ok(&dir, &["worktree", "lock", &target]);
    let locked = module
        .validate(&remove_request(&target))
        .expect("remove Gate");
    assert!(issue_codes(&locked).contains(&"gate_worktree_locked".to_owned()));
    git_ok(&dir, &["worktree", "unlock", &target]);

    // 未跟踪文件导致不干净：Git 会拒绝移除，Gate 提前给出可读提示。
    write(&Path::new(&target).join("untracked.txt"), "x\n");
    let dirty = module
        .validate(&remove_request(&target))
        .expect("remove Gate");
    assert!(issue_codes(&dirty).contains(&"worktree_remove_dirty".to_owned()));
    std::fs::remove_file(Path::new(&target).join("untracked.txt")).expect("删除未跟踪文件");

    // 干净后移除成功，列表不再包含该条目。
    let report = module
        .validate(&remove_request(&target))
        .expect("remove Gate");
    assert!(report.ok, "{:?}", issue_codes(&report));
    let outcome = module
        .execute(&remove_request(&target))
        .expect("执行 remove");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.worktreeRemoved"));
    assert!(!Path::new(&target).exists());
    let entries = module.list_worktrees().expect("列出 worktree");
    assert_eq!(entries.len(), 1);
    assert!(entries[0].is_main);
}

#[test]
fn commit_template_reads_relative_path_and_ignores_missing_or_oversize() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "c1");
    let module = module(dir);

    // 未配置。
    assert!(module.read_commit_template().expect("读取模板").is_none());

    // 相对路径按仓库根解析。
    write(&dir.join("commit-template.txt"), "feat: 描述\n\n正文\n");
    git_ok(dir, &["config", "commit.template", "commit-template.txt"]);
    let template = module
        .read_commit_template()
        .expect("读取模板")
        .expect("模板应命中");
    assert!(
        template.content.starts_with("feat: 描述"),
        "{}",
        template.content
    );
    assert!(Path::new(&template.path).is_absolute(), "{}", template.path);

    // 文件不存在时静默返回 None。
    git_ok(dir, &["config", "commit.template", "missing-template.txt"]);
    assert!(module.read_commit_template().expect("读取模板").is_none());

    // 超过 64 KiB 时不截断、直接忽略。
    let oversize = vec![b'a'; 64 * 1024 + 1];
    std::fs::write(dir.join("big-template.txt"), &oversize).expect("写入大文件");
    git_ok(dir, &["config", "commit.template", "big-template.txt"]);
    assert!(module.read_commit_template().expect("读取模板").is_none());

    // 非法 UTF-8 按 lossy 返回。
    std::fs::write(dir.join("lossy-template.txt"), [0xE4, 0xBD, 0xFF]).expect("写入非法 UTF-8");
    git_ok(dir, &["config", "commit.template", "lossy-template.txt"]);
    let lossy = module
        .read_commit_template()
        .expect("读取模板")
        .expect("模板应命中");
    assert!(lossy.content.contains('\u{FFFD}'), "{:?}", lossy.content);
}
