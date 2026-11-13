//! 目录级对比的树遍历（ADR-0025）：嵌套目录、annotated tag peel 与只读性。

use std::collections::BTreeMap;

use git_core::{Result, UserVisibleError};
use git_read::{GitReadModule, TreeSink};
use test_support::{commit, git_ok, init_temp_repo, oid_of, read_oid};

#[derive(Default)]
struct Recording {
    dirs: Vec<String>,
    files: BTreeMap<String, (Vec<u8>, bool, bool)>,
}

impl TreeSink for Recording {
    fn entry_dir(&mut self, path: &str) -> Result<()> {
        self.dirs.push(path.to_owned());
        Ok(())
    }

    fn entry_blob(
        &mut self,
        path: &str,
        data: &[u8],
        executable: bool,
        symlink: bool,
    ) -> Result<()> {
        self.files
            .insert(path.to_owned(), (data.to_vec(), executable, symlink));
        Ok(())
    }
}

#[test]
fn exports_nested_tree_from_annotated_tag() {
    let repo = init_temp_repo();
    commit(repo.path(), "README.md", "hello\n", "c1");
    for sub in ["src", "docs"] {
        std::fs::create_dir_all(repo.path().join(sub)).expect("创建子目录");
    }
    commit(repo.path(), "src/main.rs", "fn main() {}\n", "c2");
    commit(repo.path(), "docs/目录说明.txt", "目录\n", "c3");
    git_ok(repo.path(), &["tag", "-a", "v1", "-m", "release"]);

    let module = GitReadModule::open(repo.path(), None).expect("打开仓库");
    let tag = oid_of(&read_oid(repo.path(), "refs/tags/v1"));
    let mut sink = Recording::default();
    let stats = module.export_tree(&tag, &mut sink).expect("遍历树");

    assert_eq!(stats.files, 3, "{stats:?}");
    assert_eq!(stats.skipped, 0, "{stats:?}");
    assert_eq!(sink.dirs, vec!["docs", "src"]);
    assert_eq!(
        sink.files.keys().cloned().collect::<Vec<_>>(),
        vec!["README.md", "docs/目录说明.txt", "src/main.rs"]
    );
    assert_eq!(sink.files["README.md"].0, b"hello\n");
    assert_eq!(sink.files["docs/目录说明.txt"].0, "目录\n".as_bytes());
    assert!(!sink.files["README.md"].1);
    assert!(!sink.files["README.md"].2);
}

#[test]
fn missing_object_is_reported() {
    let repo = init_temp_repo();
    commit(repo.path(), "a.txt", "a\n", "c1");
    let module = GitReadModule::open(repo.path(), None).expect("打开仓库");
    let mut sink = Recording::default();
    let err = module
        .export_tree(&oid_of(&"0".repeat(40)), &mut sink)
        .expect_err("不存在的对象应报错");
    assert_eq!(err.code, git_core::ErrorCode::Internal);
}

#[test]
fn sink_error_stops_the_walk() {
    struct Failing;
    impl TreeSink for Failing {
        fn entry_dir(&mut self, _path: &str) -> Result<()> {
            Ok(())
        }
        fn entry_blob(
            &mut self,
            _path: &str,
            _data: &[u8],
            _executable: bool,
            _symlink: bool,
        ) -> Result<()> {
            Err(UserVisibleError::new(git_core::ErrorCode::Io, "磁盘已满"))
        }
    }
    let repo = init_temp_repo();
    let head = oid_of(&commit(repo.path(), "a.txt", "a\n", "c1"));
    let module = GitReadModule::open(repo.path(), None).expect("打开仓库");
    let err = module
        .export_tree(&head, &mut Failing)
        .expect_err("sink 错误应向上传播");
    assert_eq!(err.code, git_core::ErrorCode::Io);
}
