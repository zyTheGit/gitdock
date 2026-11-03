//! 测试共享夹具：跨测试进程只生成一次，避免并发写入同一目录。

use fixture_gen::FixtureSet;
use git_core::Oid;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tempfile::TempDir;

static FIXTURES: OnceLock<FixtureSet> = OnceLock::new();

pub fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_owned()
}

pub fn fixture_root() -> PathBuf {
    std::env::var("GIT_GRAPH_FIXTURE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root().join("target").join("test-fixtures"))
}

pub fn fixtures() -> &'static FixtureSet {
    FIXTURES.get_or_init(|| {
        let root = fixture_root();
        let marker = root.join(".fixtures-ok");
        if marker.exists() {
            return FixtureSet { root };
        }

        let lock = root.join(".fixtures-lock");
        std::fs::create_dir_all(&root).expect("创建夹具目录");
        let start = Instant::now();
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
            {
                Ok(_) => break,
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    if marker.exists() {
                        return FixtureSet { root };
                    }
                    if start.elapsed() > Duration::from_secs(180) {
                        panic!("等待其它测试进程生成夹具超时");
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(err) => panic!("创建夹具锁失败: {err}"),
            }
        }

        // 持锁后再次确认，避免重复生成。
        let set = if marker.exists() {
            FixtureSet { root }
        } else {
            let set = fixture_gen::generate_all(&root).expect("生成夹具失败");
            std::fs::write(&marker, b"ok").expect("写入夹具标记失败");
            set
        };
        let _ = std::fs::remove_file(&lock);
        set
    })
}

pub fn git_ok(repo: &Path, args: &[&str]) -> String {
    fixture_gen::git_output(repo, args).unwrap_or_else(|e| panic!("git {args:?} 失败: {e}"))
}

pub fn read_oid(repo: &Path, rev: &str) -> String {
    git_ok(repo, &["rev-parse", rev])
}

pub fn current_head(repo: &Path) -> String {
    git_ok(repo, &["rev-parse", "HEAD"])
}

pub fn write(path: &Path, content: &str) {
    std::fs::write(path, content).expect("写入测试文件");
}
/// 把十六进制 OID 字符串解析为 Oid；非法输入直接 panic，仅用于测试断言前置。
pub fn oid_of(text: &str) -> Oid {
    Oid::new(text).expect("合法 OID")
}

/// 在系统临时目录下创建「前缀-进程号」目录；已存在则先清空，保证测试可重复运行。
pub fn temp_dir(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).expect("清理旧临时目录");
    }
    std::fs::create_dir_all(&dir).expect("创建临时目录");
    dir
}

/// 递归复制目录树（含子目录与文件），目标目录不存在时自动创建。
pub fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("创建目标目录");
    for entry in std::fs::read_dir(from).expect("读取源目录") {
        let entry = entry.expect("目录项");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("文件类型").is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), &target).expect("复制文件");
        }
    }
}

/// 在给定目录初始化空仓库（默认分支 main）并写入测试署名；
/// 同时关闭 core.autocrlf 与 commit.gpgSign，屏蔽本机全局配置对断言的干扰。
pub fn init_repo(dir: &Path) {
    git_ok(dir, &["init", "-q", "-b", "main"]);
    git_ok(dir, &["config", "user.name", "Test"]);
    git_ok(dir, &["config", "user.email", "test@example.com"]);
    git_ok(dir, &["config", "core.autocrlf", "false"]);
    git_ok(dir, &["config", "commit.gpgSign", "false"]);
}

/// 新建临时目录并在其中初始化空仓库；返回 TempDir，drop 时自动清理。
pub fn init_temp_repo() -> TempDir {
    let temp = TempDir::new().expect("临时目录");
    init_repo(temp.path());
    temp
}

/// 写入单个文件、暂存全部改动并提交，返回新提交的 OID。
pub fn commit(dir: &Path, name: &str, content: &str, message: &str) -> String {
    write(&dir.join(name), content);
    git_ok(dir, &["add", "-A"]);
    git_ok(dir, &["commit", "-m", message]);
    git_ok(dir, &["rev-parse", "HEAD"])
}
