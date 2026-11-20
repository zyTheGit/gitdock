//! write 集成测试公共夹具：请求构造器与冲突/合并仓库。
//!
//! 各测试二进制只用到其中一部分，未使用的条目不应产生 dead_code 告警。

#![allow(dead_code)]

use std::path::{Path, PathBuf};

use git_core::{InterruptionKind, Oid, WriteKind, WriteRequest};
use tempfile::TempDir;
use test_support::{commit, git_ok, init_temp_repo, temp_dir};

pub fn base_request(kind: WriteKind) -> WriteRequest {
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
        path: None,
        hunk_index: None,
        remote: None,
        reset_mode: None,
    }
}

pub fn request(
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

pub fn pick_request(kind: WriteKind, oid: &str, mainline: Option<u32>) -> WriteRequest {
    WriteRequest {
        oid: Some(Oid::new(oid).expect("oid")),
        mainline,
        ..base_request(kind)
    }
}

pub fn operation_request(kind: WriteKind, interruption: InterruptionKind) -> WriteRequest {
    WriteRequest {
        interruption: Some(interruption),
        ..base_request(kind)
    }
}

pub fn staging_request(kind: WriteKind, paths: &[&str]) -> WriteRequest {
    WriteRequest {
        paths: Some(paths.iter().map(|path| (*path).to_owned()).collect()),
        ..base_request(kind)
    }
}

pub fn conflict_repo() -> (TempDir, String) {
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
pub fn merge_repo() -> (TempDir, String, String, String) {
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

/// 本地 bare remote 沙箱（ADR-0028 远程同步测试用）：`source` 负责往远端推分支，
/// `local` 是从远端 clone 出来、带 `origin/main` 上游的工作仓库。
pub struct RemoteSandbox {
    pub dir: PathBuf,
    pub source: PathBuf,
    pub remote: PathBuf,
    pub local: PathBuf,
}

impl RemoteSandbox {
    pub fn local(&self) -> &Path {
        &self.local
    }

    pub fn remote(&self) -> &Path {
        &self.remote
    }

    pub fn source(&self) -> &Path {
        &self.source
    }
}

/// clone 出来的仓库不带 user 配置，补齐并屏蔽本机全局配置对断言的干扰。
pub fn configure_repo(dir: &Path) {
    for (key, value) in [
        ("user.name", "Test"),
        ("user.email", "test@example.com"),
        ("core.autocrlf", "false"),
        ("commit.gpgSign", "false"),
    ] {
        git_ok(dir, &["config", key, value]);
    }
}

/// 建立 bare remote + 从它 clone 的本地仓库；`prefix` 必须在进程内唯一（并发测试）。
pub fn remote_sandbox(prefix: &str) -> RemoteSandbox {
    let dir = temp_dir(prefix);
    let source = dir.join("source");
    std::fs::create_dir_all(&source).expect("创建 source");
    init_temp_repo_at(&source);
    commit(&source, "a.txt", "base\n", "c1");

    let remote = dir.join("remote.git");
    std::fs::create_dir_all(&remote).expect("创建 bare remote");
    git_ok(&remote, &["init", "--bare", "-b", "main"]);
    let remote_str = remote.to_string_lossy().into_owned();
    git_ok(&source, &["remote", "add", "origin", &remote_str]);
    git_ok(&source, &["push", "-u", "origin", "main"]);

    let local = dir.join("local");
    git_ok(
        &dir,
        &["-c", "core.autocrlf=false", "clone", &remote_str, "local"],
    );
    configure_repo(&local);
    RemoteSandbox {
        dir,
        source,
        remote,
        local,
    }
}

fn init_temp_repo_at(dir: &Path) {
    git_ok(dir, &["init", "-q", "-b", "main"]);
    configure_repo(dir);
}
