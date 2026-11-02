//! 可复现 Git 夹具生成器。
//!
//! 所有仓库都固定作者、提交时间与全局配置，生成结果在相同 Git 版本下可复现。
//! 使用 `git` 可执行文件仅为构造测试夹具，不参与应用运行时。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

#[derive(Debug)]
pub struct FixtureError(pub String);

impl std::fmt::Display for FixtureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FixtureError {}

type Result<T> = std::result::Result<T, FixtureError>;

#[derive(Debug, Clone)]
pub struct FixtureSet {
    pub root: PathBuf,
}

impl FixtureSet {
    pub fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    pub fn linear(&self) -> PathBuf {
        self.path("linear")
    }

    pub fn forked(&self) -> PathBuf {
        self.path("forked")
    }

    pub fn conflict(&self) -> PathBuf {
        self.path("conflict")
    }

    pub fn dirty(&self) -> PathBuf {
        self.path("dirty")
    }

    pub fn shallow(&self) -> PathBuf {
        self.path("shallow")
    }

    pub fn bare(&self) -> PathBuf {
        self.path("bare")
    }

    pub fn worktree_linked(&self) -> PathBuf {
        self.path("worktree-linked")
    }

    pub fn sha256(&self) -> PathBuf {
        self.path("sha256")
    }

    pub fn perf(&self) -> PathBuf {
        self.path("perf")
    }
}

/// 生成全部夹具。`root` 下的旧内容会被整体替换（仅限该目录）。
pub fn generate_all(root: &Path) -> Result<FixtureSet> {
    // 相对路径会在 file:// 克隆与子目录 cwd 下被错误解析，入口统一绝对化。
    let root = std::path::absolute(root)
        .map_err(|e| FixtureError(format!("解析夹具根目录失败 {}: {e}", root.display())))?;
    let root = root.as_path();
    std::fs::create_dir_all(root)
        .map_err(|e| FixtureError(format!("创建夹具目录失败 {}: {e}", root.display())))?;
    let empty_config = root.join("gitconfig-empty");
    std::fs::write(&empty_config, b"")
        .map_err(|e| FixtureError(format!("写入空 gitconfig 失败: {e}")))?;

    let env = Env {
        empty_config,
        root: root.to_owned(),
    };

    let linear = root.join("linear");
    build_linear(&env, &linear)?;

    let forked = root.join("forked");
    build_forked(&env, &forked)?;

    let conflict = root.join("conflict");
    build_conflict(&env, &conflict)?;

    build_empty_pick(&env, &root.join("empty-pick"))?;
    build_hook_reject(&env, &root.join("hook-reject"))?;
    build_dirty(&env, &root.join("dirty"))?;
    build_worktree(&env, root)?;

    // 通过本地 file:// 克隆，避免依赖网络。
    let shallow = root.join("shallow");
    clone_shallow(&env, &linear, &shallow)?;
    let bare = root.join("bare");
    clone_bare(&env, &linear, &bare)?;

    build_sha256(&env, &root.join("sha256"))?;

    Ok(FixtureSet {
        root: root.to_owned(),
    })
}

/// 生成用于性能测试的线性仓库（fast-import）。返回实际提交数。
pub fn generate_perf(root: &Path, commits: usize) -> Result<usize> {
    std::fs::create_dir_all(root).map_err(|e| FixtureError(format!("创建目录失败: {e}")))?;
    let repo = root.join("perf");
    if repo.exists() {
        std::fs::remove_dir_all(&repo)
            .map_err(|e| FixtureError(format!("清理旧性能仓库失败: {e}")))?;
    }
    run_git(root, &["init", "-q", "-b", "main", repo.to_str().unwrap()])?;

    let mut stream = String::new();
    for i in 0..commits {
        let timestamp = 1_700_000_000 + i as i64;
        let content = format!("commit {i}\n");
        stream.push_str("commit refs/heads/main\n");
        stream.push_str(&format!(
            "committer Perf <perf@example.com> {timestamp} +0000\n"
        ));
        let msg = format!("perf commit {i}");
        stream.push_str(&format!("data {}\n{}\n", msg.len(), msg));
        stream.push_str("M 644 inline file.txt\n");
        stream.push_str(&format!("data {}\n{}", content.len(), content));
        stream.push('\n');
    }

    let mut child = Command::new(git_program())
        .args(["-C", repo.to_str().unwrap(), "fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| FixtureError(format!("启动 fast-import 失败: {e}")))?;
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(stream.as_bytes())
        .map_err(|e| FixtureError(format!("写入 fast-import 失败: {e}")))?;
    let out = child
        .wait_with_output()
        .map_err(|e| FixtureError(format!("等待 fast-import 失败: {e}")))?;
    if !out.status.success() {
        return Err(FixtureError(format!(
            "fast-import 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    run_git(&repo, &["reset", "-q", "--hard", "main"])?;
    Ok(commits)
}

struct Env {
    empty_config: PathBuf,
    root: PathBuf,
}

impl Env {
    fn command(&self) -> Command {
        let mut cmd = Command::new(git_program());
        cmd.env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", &self.empty_config)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .env("GIT_AUTHOR_NAME", "Fixture")
            .env("GIT_AUTHOR_EMAIL", "fixture@example.com")
            .env("GIT_COMMITTER_NAME", "Fixture")
            .env("GIT_COMMITTER_EMAIL", "fixture@example.com");
        cmd
    }
}

fn git_program() -> String {
    std::env::var("GIT_EXECUTABLE").unwrap_or_else(|_| "git".to_owned())
}

fn run_git_env(env: Option<&Env>, cwd: &Path, args: &[&str]) -> Result<Output> {
    let mut cmd = match env {
        Some(env) => env.command(),
        None => {
            let mut c = Command::new(git_program());
            c.env("GIT_TERMINAL_PROMPT", "0");
            c
        }
    };
    let out = cmd
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| FixtureError(format!("运行 git {args:?} 失败: {e}")))?;
    if !out.status.success() {
        return Err(FixtureError(format!(
            "git {args:?} 失败（{}）: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(out)
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<Output> {
    run_git_env(None, cwd, args)
}

fn init_repo(env: &Env, repo: &Path, object_format: Option<&str>) -> Result<()> {
    std::fs::create_dir_all(repo).map_err(|e| FixtureError(format!("创建仓库目录失败: {e}")))?;
    let mut args = vec!["init", "-q", "-b", "main"];
    if let Some(format) = object_format {
        args.push("--object-format");
        args.push(format);
    }
    run_git_env(Some(env), repo, &args)?;
    run_git_env(Some(env), repo, &["config", "core.autocrlf", "false"])?;
    run_git_env(Some(env), repo, &["config", "core.fileMode", "false"])?;
    Ok(())
}

fn write_file(repo: &Path, relative: &str, content: &str) -> Result<()> {
    let path = repo.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| FixtureError(format!("创建文件父目录失败: {e}")))?;
    }
    std::fs::write(&path, content).map_err(|e| FixtureError(format!("写入文件失败: {e}")))
}

fn commit(
    env: &Env,
    repo: &Path,
    files: &[(&str, &str)],
    message: &str,
    minute: i64,
) -> Result<String> {
    for (path, content) in files {
        write_file(repo, path, content)?;
    }
    run_git_env(Some(env), repo, &["add", "-A"])?;
    let date = format!("2024-01-01T00:{:02}:00+0000", minute % 60);
    let mut cmd = env.command();
    let out = cmd
        .current_dir(repo)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .args(["commit", "-q", "-m", message])
        .output()
        .map_err(|e| FixtureError(format!("git commit 失败: {e}")))?;
    if !out.status.success() {
        return Err(FixtureError(format!(
            "git commit 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    let out = run_git_env(Some(env), repo, &["rev-parse", "HEAD"])?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

fn git_with_date(env: &Env, repo: &Path, args: &[&str], minute: i64) -> Result<String> {
    let date = format!("2024-01-01T00:{:02}:00+0000", minute % 60);
    let mut cmd = env.command();
    let out = cmd
        .current_dir(repo)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .args(args)
        .output()
        .map_err(|e| FixtureError(format!("git {args:?} 失败: {e}")))?;
    if !out.status.success() {
        return Err(FixtureError(format!(
            "git {args:?} 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

fn build_linear(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    let mut content = String::new();
    for i in 1..=6 {
        content.push_str(&format!("line {i}\n"));
        commit(
            env,
            repo,
            &[("linear.txt", &content)],
            &format!("linear commit {i}"),
            i,
        )?;
    }
    // 注释 tag 指向第 3 个提交，轻量 tag 指向第 5 个提交。
    let c3 = git_with_date(env, repo, &["rev-parse", "HEAD~3"], 3)?;
    let c5 = git_with_date(env, repo, &["rev-parse", "HEAD~1"], 5)?;
    git_with_date(
        env,
        repo,
        &["tag", "-a", "v1.0", "-m", "release 1.0", &c3],
        10,
    )?;
    git_with_date(env, repo, &["tag", "v1.1", &c5], 11)?;
    // 手工构造远程跟踪 ref，避免网络依赖。
    run_git_env(
        Some(env),
        repo,
        &["update-ref", "refs/remotes/origin/main", "HEAD"],
    )?;
    run_git_env(
        Some(env),
        repo,
        &["update-ref", "refs/remotes/origin/topic", "HEAD~2"],
    )?;
    // 分支描述夹具。
    run_git_env(
        Some(env),
        repo,
        &["config", "--local", "branch.main.description", "线性主分支"],
    )?;
    Ok(())
}

fn build_forked(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    commit(env, repo, &[("base.txt", "base\n")], "forked base", 1)?;
    commit(env, repo, &[("base.txt", "base\nshared\n")], "forked c2", 2)?;
    git_with_date(env, repo, &["switch", "-q", "-c", "feature"], 3)?;
    commit(
        env,
        repo,
        &[("feature.txt", "feature-1\n")],
        "feature c1",
        4,
    )?;
    commit(
        env,
        repo,
        &[("feature.txt", "feature-1\nfeature-2\n")],
        "feature c2",
        5,
    )?;
    git_with_date(env, repo, &["switch", "-q", "main"], 6)?;
    commit(env, repo, &[("main.txt", "main-1\n")], "main c3", 7)?;
    git_with_date(
        env,
        repo,
        &[
            "merge",
            "--no-ff",
            "-m",
            "merge feature into main",
            "feature",
        ],
        8,
    )?;
    commit(
        env,
        repo,
        &[("main.txt", "main-1\nmain-2\n")],
        "main after merge",
        9,
    )?;
    let head = git_with_date(env, repo, &["rev-parse", "HEAD"], 9)?;
    git_with_date(
        env,
        repo,
        &["tag", "-a", "v2.0", "-m", "release 2.0", &head],
        12,
    )?;
    run_git_env(
        Some(env),
        repo,
        &["update-ref", "refs/remotes/origin/main", "main"],
    )?;
    run_git_env(
        Some(env),
        repo,
        &["update-ref", "refs/remotes/origin/feature", "feature"],
    )?;
    Ok(())
}

fn build_conflict(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    commit(env, repo, &[("conflict.txt", "base\n")], "conflict base", 1)?;
    git_with_date(env, repo, &["switch", "-q", "-c", "feature"], 2)?;
    commit(
        env,
        repo,
        &[("conflict.txt", "feature\n")],
        "feature changes same line",
        3,
    )?;
    git_with_date(env, repo, &["switch", "-q", "main"], 4)?;
    commit(
        env,
        repo,
        &[("conflict.txt", "main\n")],
        "main changes same line",
        5,
    )?;
    // 可成功 cherry-pick 的来源分支。
    git_with_date(env, repo, &["switch", "-q", "-c", "pick-source"], 6)?;
    commit(
        env,
        repo,
        &[("picked.txt", "picked\n")],
        "commit to cherry pick",
        7,
    )?;
    git_with_date(env, repo, &["switch", "-q", "main"], 8)?;
    Ok(())
}

fn build_empty_pick(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    commit(env, repo, &[("base.txt", "base\n")], "empty base", 1)?;
    git_with_date(env, repo, &["switch", "-q", "-c", "source"], 2)?;
    commit(env, repo, &[("same.txt", "same\n")], "source change", 3)?;
    git_with_date(env, repo, &["switch", "-q", "main"], 4)?;
    // 在 main 上以另一个提交产生相同树变化。
    commit(env, repo, &[("same.txt", "same\n")], "main same change", 5)?;
    git_with_date(env, repo, &["switch", "-q", "-c", "empty-target"], 6)?;
    Ok(())
}

fn build_hook_reject(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    commit(env, repo, &[("base.txt", "base\n")], "hook base", 1)?;
    git_with_date(env, repo, &["switch", "-q", "-c", "pick-source"], 2)?;
    commit(env, repo, &[("hooked.txt", "hooked\n")], "hook source", 3)?;
    git_with_date(env, repo, &["switch", "-q", "main"], 4)?;
    let hook = repo.join(".git").join("hooks").join("pre-commit");
    std::fs::create_dir_all(hook.parent().unwrap())
        .map_err(|e| FixtureError(format!("创建 hooks 目录失败: {e}")))?;
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'fixture hook rejects commit' >&2\nexit 1\n",
    )
    .map_err(|e| FixtureError(format!("写入 hook 失败: {e}")))?;
    Ok(())
}

fn build_dirty(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, None)?;
    commit(env, repo, &[("tracked.txt", "clean\n")], "dirty base", 1)?;
    write_file(repo, "tracked.txt", "modified\n")?;
    write_file(repo, "untracked.txt", "untracked\n")?;
    Ok(())
}

fn build_worktree(env: &Env, root: &Path) -> Result<()> {
    let main = root.join("worktree-main");
    let linked = root.join("worktree-linked");
    init_repo(env, &main, None)?;
    commit(env, &main, &[("main.txt", "main\n")], "worktree base", 1)?;
    git_with_date(env, &main, &["branch", "wt-branch"], 2)?;
    let out = Command::new(git_program())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", &env.empty_config)
        .current_dir(&main)
        .args(["worktree", "add", linked.to_str().unwrap(), "wt-branch"])
        .output()
        .map_err(|e| FixtureError(format!("worktree add 失败: {e}")))?;
    if !out.status.success() {
        return Err(FixtureError(format!(
            "worktree add 失败: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(())
}

fn clone_shallow(env: &Env, source: &Path, dest: &Path) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let url = file_url(source);
    run_git_env(
        Some(env),
        env.root.as_path(),
        &["clone", "-q", "--depth", "2", &url, dest.to_str().unwrap()],
    )?;
    Ok(())
}

fn clone_bare(env: &Env, source: &Path, dest: &Path) -> Result<()> {
    run_git_env(
        Some(env),
        env.root.as_path(),
        &[
            "clone",
            "-q",
            "--bare",
            source.to_str().unwrap(),
            dest.to_str().unwrap(),
        ],
    )?;
    Ok(())
}

fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    if text.starts_with('/') {
        format!("file://{text}")
    } else {
        format!("file:///{text}")
    }
}

fn build_sha256(env: &Env, repo: &Path) -> Result<()> {
    init_repo(env, repo, Some("sha256"))?;
    commit(
        env,
        repo,
        &[("sha.txt", "sha256-1\n")],
        "sha256 commit 1",
        1,
    )?;
    commit(
        env,
        repo,
        &[("sha.txt", "sha256-1\nsha256-2\n")],
        "sha256 commit 2",
        2,
    )?;
    let head = git_with_date(env, repo, &["rev-parse", "HEAD"], 2)?;
    git_with_date(
        env,
        repo,
        &["tag", "-a", "sha-tag", "-m", "sha tag", &head],
        3,
    )?;
    Ok(())
}

/// 供测试直接执行 git 并取得输出。
pub fn git_output(repo: &Path, args: &[&str]) -> Result<String> {
    let out = run_git(repo, args)?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}
