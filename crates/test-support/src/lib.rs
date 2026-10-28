//! 测试共享夹具：跨测试进程只生成一次，避免并发写入同一目录。

use fixture_gen::FixtureSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

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
