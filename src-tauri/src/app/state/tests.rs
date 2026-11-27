//! 多仓库标签页注册表测试（ADR-0032）。
//!
//! 不依赖开发者本机仓库：每个用例在临时目录 `git init` 出最小仓库。

use std::path::{Path, PathBuf};
use std::process::Command;

use git_core::UserVisibleError;
use git_read::GitReadModule;
use git_write::GitWriteModule;

use super::*;

struct TempRepo {
    _dir: tempfile::TempDir,
    path: PathBuf,
}

/// 创建临时仓库并 `git init`；只写临时目录，不触碰任何真实仓库。
fn temp_repo() -> TempRepo {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let path = dir.path().canonicalize().expect("规范化临时目录失败");
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .arg(&path)
        .status()
        .expect("执行 git init 失败");
    assert!(status.success(), "git init 失败：{}", path.display());
    TempRepo { _dir: dir, path }
}

fn repo_session(path: &Path) -> Session {
    let read = GitReadModule::open(path, None).expect("打开临时仓库失败");
    let write = GitWriteModule::new(path).expect("创建写模块失败");
    Session { read, write }
}

fn open(registry: &RepoRegistry, repo: &TempRepo) -> RepoId {
    registry
        .insert(repo.path.clone(), repo_session(&repo.path))
        .expect("打开仓库失败")
        .id
}

/// 与 command 的「打开或激活」一致：先按规范化路径找，找不到才登记。
fn open_or_activate(registry: &RepoRegistry, repo: &TempRepo) -> RepoId {
    match registry.find_by_path(&repo.path).expect("查询路径失败") {
        Some(entry) => {
            registry.set_active(entry.id).expect("激活仓库失败");
            entry.id
        }
        None => open(registry, repo),
    }
}

fn error_of<T>(result: Result<T>) -> UserVisibleError {
    match result {
        Ok(_) => panic!("预期返回错误，实际成功"),
        Err(err) => err,
    }
}

#[test]
fn opening_two_repositories_makes_the_second_active() {
    let registry = RepoRegistry::new();
    let first = temp_repo();
    let second = temp_repo();

    let first_id = open_or_activate(&registry, &first);
    let second_id = open_or_activate(&registry, &second);

    assert_ne!(first_id, second_id);
    assert_eq!(
        registry.active_id().expect("读取活动仓库失败"),
        Some(second_id)
    );
    assert_eq!(registry.list().expect("读取仓库列表失败").len(), 2);
}

#[test]
fn reopening_same_path_reuses_entry_without_duplicate() {
    let registry = RepoRegistry::new();
    let first = temp_repo();
    let second = temp_repo();
    let first_id = open_or_activate(&registry, &first);
    open_or_activate(&registry, &second);

    let reopened = open_or_activate(&registry, &first);

    assert_eq!(reopened, first_id);
    assert_eq!(
        registry.active_id().expect("读取活动仓库失败"),
        Some(first_id)
    );
    assert_eq!(registry.list().expect("读取仓库列表失败").len(), 2);
}

#[test]
fn inserting_same_path_twice_keeps_one_entry() {
    let registry = RepoRegistry::new();
    let repo = temp_repo();
    let first_id = open(&registry, &repo);
    let again = registry
        .insert(repo.path.clone(), repo_session(&repo.path))
        .expect("重复登记失败");
    assert_eq!(again.id, first_id);
    assert_eq!(registry.list().expect("读取仓库列表失败").len(), 1);
}

#[test]
fn closing_active_tab_promotes_most_recently_opened_remaining() {
    let registry = RepoRegistry::new();
    let first = temp_repo();
    let second = temp_repo();
    let third = temp_repo();
    let first_id = open_or_activate(&registry, &first);
    open_or_activate(&registry, &second);
    let third_id = open_or_activate(&registry, &third);

    registry.set_active(first_id).expect("激活第一个仓库失败");
    registry.remove(first_id).expect("关闭活动标签失败");

    // 剩余标签里最近打开的是第三个。
    assert_eq!(
        registry.active_id().expect("读取活动仓库失败"),
        Some(third_id)
    );
    assert_eq!(registry.list().expect("读取仓库列表失败").len(), 2);
}

#[test]
fn closing_last_tab_leaves_no_active_entry() {
    let registry = RepoRegistry::new();
    let repo = temp_repo();
    let id = open_or_activate(&registry, &repo);
    registry.remove(id).expect("关闭唯一标签失败");
    assert_eq!(registry.active_id().expect("读取活动仓库失败"), None);
    assert!(registry.active_entry().expect("读取活动条目失败").is_none());
}

#[test]
fn closing_unknown_repository_errors() {
    let registry = RepoRegistry::new();
    let err = error_of(registry.remove(42));
    assert_eq!(err.code, git_core::ErrorCode::RepositoryNotFound);
    assert_eq!(err.key.as_deref(), Some("errors.repositoryNotFound"));
}

#[test]
fn empty_registry_reports_not_open() {
    let registry = RepoRegistry::new();
    let err = error_of(registry.entry_or_active(None));
    assert_eq!(err.key.as_deref(), Some("errors.repoNotOpen"));
}

#[test]
fn repositories_are_not_capped_and_existing_paths_still_activate() {
    let registry = RepoRegistry::new();
    let mut repos = Vec::new();
    // 超过历史上限 8，确认注册表不再拒绝新标签（ADR-0036）。
    for _ in 0..12 {
        let repo = temp_repo();
        open_or_activate(&registry, &repo);
        repos.push(repo);
    }
    assert_eq!(registry.list().expect("读取仓库列表失败").len(), 12);

    let first_id = registry
        .find_by_path(&repos[0].path)
        .expect("查询路径失败")
        .expect("应找到已打开仓库")
        .id;
    registry.set_active(first_id).expect("激活已有仓库失败");
    assert_eq!(
        registry.active_id().expect("读取活动仓库失败"),
        Some(first_id)
    );
    // 最近激活顺序决定监听池保留对象：刚切换的仓库必须排在最前。
    let recent = registry.by_recent_activity().expect("读取活动顺序失败");
    assert_eq!(recent.first().map(|entry| entry.id), Some(first_id));
}

#[test]
fn explicit_repo_id_routes_without_cross_repo_leakage() {
    let registry = RepoRegistry::new();
    let first = temp_repo();
    let second = temp_repo();
    let first_id = open_or_activate(&registry, &first);
    let second_id = open_or_activate(&registry, &second);
    // 当前活动仓库是 second；显式传入 first_id 仍精确命中 first，不串仓。
    assert_eq!(registry.active_id().expect("读取活动仓库"), Some(second_id));
    let routed = registry
        .entry_or_active(Some(first_id))
        .expect("按显式 repo_id 路由失败");
    assert_eq!(routed.id, first_id);
    assert_eq!(routed.path, first.path);
    let err = error_of(registry.entry_or_active(Some(999_999)));
    assert_eq!(err.code, git_core::ErrorCode::RepositoryNotFound);
}
