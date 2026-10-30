//! GitWriteModule 公开接口的行为验证：Gate、状态机与 CLI 结果判定。

use std::path::Path;
use std::process::Command;

use git_core::{FileStatus, Oid, WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("启动 git");
    assert!(
        output.status.success(),
        "git {args:?} 失败：{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn write(path: &Path, name: &str, content: &str) {
    let target = path.join(name);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).expect("创建目录");
    }
    std::fs::write(target, content).expect("写文件");
}

fn commit(dir: &Path, name: &str, content: &str, message: &str) -> String {
    write(dir, name, content);
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", message]);
    git(dir, &["rev-parse", "HEAD"]).trim().to_owned()
}

fn init_repo() -> TempDir {
    let temp = TempDir::new().expect("临时目录");
    let dir = temp.path();
    git(dir, &["init", "-b", "main"]);
    git(dir, &["config", "user.name", "测试用户"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgSign", "false"]);
    temp
}

fn request(
    kind: WriteKind,
    oid: Option<&str>,
    branch: Option<&str>,
    description: Option<&str>,
) -> WriteRequest {
    WriteRequest {
        kind,
        oid: oid.map(|value| Oid::new(value).expect("oid")),
        branch: branch.map(str::to_owned),
        description: description.map(str::to_owned),
        paths: None,
    }
}

fn staging_request(kind: WriteKind, paths: &[&str]) -> WriteRequest {
    WriteRequest {
        kind,
        oid: None,
        branch: None,
        description: None,
        paths: Some(paths.iter().map(|path| (*path).to_owned()).collect()),
    }
}

fn conflict_repo() -> (TempDir, String) {
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "conflict.txt", "a\nb\nc\n", "base");
    git(dir, &["switch", "-c", "feature"]);
    let feature = commit(dir, "conflict.txt", "a\nfeature\nc\n", "feature 修改同一行");
    git(dir, &["switch", "main"]);
    commit(dir, "conflict.txt", "a\nmain\nc\n", "main 修改同一行");
    (temp, feature)
}

#[test]
fn gate_rejects_untracked_and_allows_clean() {
    let temp = init_repo();
    let dir = temp.path();
    let target = commit(dir, "a.txt", "one\n", "c1");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    write(dir, "untracked.txt", "u\n");
    let report = module
        .validate(&request(WriteKind::CherryPick, Some(&target), None, None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "worktree_dirty"));

    std::fs::remove_file(dir.join("untracked.txt")).expect("删除未跟踪文件");
    let report = module
        .validate(&request(WriteKind::CherryPick, Some(&target), None, None))
        .expect("Gate");
    assert!(report.ok, "干净工作区应通过：{:?}", report.issues);
}

#[test]
fn gate_rejects_merge_commit_for_cherry_pick() {
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git(dir, &["switch", "-c", "feature"]);
    commit(dir, "b.txt", "feature\n", "feature");
    git(dir, &["switch", "main"]);
    commit(dir, "c.txt", "main\n", "main");
    git(dir, &["merge", "--no-ff", "-m", "merge feature", "feature"]);
    let merge_oid = git(dir, &["rev-parse", "HEAD"]).trim().to_owned();
    git(dir, &["switch", "-c", "probe", "HEAD~1"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(
            WriteKind::CherryPick,
            Some(&merge_oid),
            None,
            None,
        ))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report.is_merge_commit);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "merge_commit"));
}

#[test]
fn gate_rejects_detached_head() {
    let temp = init_repo();
    let dir = temp.path();
    let target = commit(dir, "a.txt", "one\n", "c1");
    commit(dir, "a.txt", "two\n", "c2");
    git(dir, &["checkout", "--detach", "HEAD~1"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let report = module
        .validate(&request(WriteKind::Revert, Some(&target), None, None))
        .expect("Gate");
    assert!(!report.ok);
    assert!(report
        .issues
        .iter()
        .any(|issue| issue.code == "detached_head"));
}

#[test]
fn cherry_pick_success_updates_head() {
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git(dir, &["switch", "-c", "feature"]);
    let feature = commit(dir, "b.txt", "feature\n", "feature");
    git(dir, &["switch", "main"]);

    let module = GitWriteModule::new(dir).expect("打开写模块");
    let outcome = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git(dir, &["rev-parse", "HEAD"]).trim(),
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
        .any(|issue| issue.code == "interrupted"));

    let interruption = module.inspect_interruption().expect("探测中断");
    assert!(interruption.is_active());
    assert!(!interruption.terminal_hint.is_empty());
}

#[test]
fn staging_status_separates_staged_and_unstaged() {
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    write(dir, "a.txt", "two\n");
    write(dir, "b.txt", "new\n");
    git(dir, &["add", "b.txt"]);

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
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(dir, "u.txt", "hello\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["u.txt"]))
        .expect("暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("暂存区状态");
    assert!(status.staged.iter().any(|file| file.path == "u.txt"));

    let diff = module.staging_file_diff("u.txt", true).expect("staged diff");
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
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "one\n", "c1");
    std::fs::remove_file(dir.join("a.txt")).expect("删除工作区文件");
    write(dir, "new.txt", "new\n");
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
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "old.txt", "same\ncontent\n", "base");
    git(dir, &["mv", "old.txt", "new.txt"]);
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
    let temp = init_repo();
    let dir = temp.path();
    write(dir, "first.txt", "first\n");
    git(dir, &["add", "first.txt"]);
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
    let temp = init_repo();
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
    assert!(!status.unstaged.iter().any(|file| file.path == "conflict.txt"));

    let outcome = module
        .execute(&staging_request(WriteKind::StageFiles, &["conflict.txt"]))
        .expect("Gate");
    assert_eq!(outcome.status, WriteStatus::Rejected);
}

#[test]
fn empty_pick_cleans_own_marker() {
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "base.txt", "base\n", "base");
    let same = commit(dir, "same.txt", "same\n", "加入 same.txt");
    git(dir, &["switch", "-c", "target", "HEAD~1"]);
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
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git(dir, &["branch", "topic"]);
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
        .any(|issue| issue.code == "branch_not_found"));

    let current = module
        .validate(&request(WriteKind::SwitchBranch, None, Some("main"), None))
        .expect("Gate");
    assert!(current
        .issues
        .iter()
        .any(|issue| issue.code == "already_on_branch"));

    let outcome = module
        .execute(&request(WriteKind::SwitchBranch, None, Some("topic"), None))
        .expect("执行");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        git(dir, &["symbolic-ref", "--short", "HEAD"]).trim(),
        "topic"
    );
}

#[test]
fn branch_description_roundtrip_uses_local_config() {
    let temp = init_repo();
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
        git(
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
    let temp = init_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    git(dir, &["branch", "occupied"]);
    let linked = temp.path().join("linked");
    git(
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
        .any(|issue| issue.code == "branch_checked_out"));
}
