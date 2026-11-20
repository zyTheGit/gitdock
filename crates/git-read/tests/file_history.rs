//! 单文件提交历史与 Blame 集成测试（ADR-0031）。

use std::path::{Path, PathBuf};

use git_core::{ErrorCode, FileStatus, MAX_DIFF_BYTES};
use git_read::GitReadModule;
use test_support::{commit, fixtures, git_ok, init_repo, oid_of, read_oid, temp_dir, write};

fn open(path: &Path) -> GitReadModule {
    GitReadModule::open(path, None).expect("打开夹具仓库")
}

fn fresh_repo(prefix: &str) -> PathBuf {
    let dir = temp_dir(prefix);
    init_repo(&dir);
    dir
}

/// 建立「根提交 + 两次 a.txt 改动 + 两次无关改动」的线性仓库。
fn linear_repo(prefix: &str) -> (PathBuf, Vec<String>) {
    let dir = fresh_repo(prefix);
    write(&dir.join("a.txt"), "one\n");
    write(&dir.join("b.txt"), "b1\n");
    git_ok(&dir, &["add", "-A"]);
    git_ok(&dir, &["commit", "-m", "root"]);
    let root = read_oid(&dir, "HEAD");
    let unrelated1 = commit(&dir, "b.txt", "b1\nb2\n", "unrelated 1");
    let change1 = commit(&dir, "a.txt", "one\ntwo\n", "change a 1");
    let unrelated2 = commit(&dir, "b.txt", "b1\nb2\nb3\n", "unrelated 2");
    let change2 = commit(&dir, "a.txt", "one\ntwo\nthree\n", "change a 2");
    (dir, vec![root, unrelated1, change1, unrelated2, change2])
}

#[test]
fn history_only_lists_commits_that_touch_the_path() {
    let (dir, oids) = linear_repo("git-graph-file-history-filter");
    let (root, unrelated1, change1, unrelated2, change2) =
        (&oids[0], &oids[1], &oids[2], &oids[3], &oids[4]);
    let read = open(&dir);
    let page = read
        .read_file_history("a.txt", None, None, 50)
        .expect("读取单文件历史");

    let actual: Vec<(&str, FileStatus)> = page
        .entries
        .iter()
        .map(|entry| (entry.commit.oid.as_str(), entry.status))
        .collect();
    assert_eq!(
        actual,
        vec![
            (change2.as_str(), FileStatus::Modified),
            (change1.as_str(), FileStatus::Modified),
            (root.as_str(), FileStatus::Added),
        ]
    );
    assert!(
        page.entries
            .iter()
            .all(|entry| entry.commit.oid.as_str() != unrelated1.as_str()
                && entry.commit.oid.as_str() != unrelated2.as_str()),
        "无关提交不得出现在单文件历史中"
    );
    assert_eq!(page.path, "a.txt");
    assert!(!page.has_more);
    assert!(page.next_cursor.is_none());
    assert!(page.entries.iter().all(|entry| entry.old_path.is_none()));
    assert!(page
        .entries
        .iter()
        .all(|entry| entry.commit.author_name == "Test"));
}

#[test]
fn history_pagination_has_no_gaps_and_hides_offsets() {
    let (dir, oids) = linear_repo("git-graph-file-history-paging");
    let read = open(&dir);
    let mut cursor: Option<String> = None;
    let mut seen: Vec<String> = Vec::new();
    loop {
        let page = read
            .read_file_history("a.txt", Some("main"), cursor.as_deref(), 2)
            .expect("分页读取单文件历史");
        seen.extend(
            page.entries
                .iter()
                .map(|e| e.commit.oid.as_str().to_owned()),
        );
        match page.next_cursor {
            Some(token) => {
                assert!(!token.contains("offset"), "游标不得暴露 offset: {token}");
                assert!(!token.contains("index"), "游标不得暴露 index: {token}");
                cursor = Some(token);
            }
            None => break,
        }
    }
    assert_eq!(
        seen,
        vec![oids[4].clone(), oids[2].clone(), oids[0].clone()]
    );
}

#[test]
fn history_accepts_explicit_commit_start_and_reports_stale_cursor() {
    let (dir, oids) = linear_repo("git-graph-file-history-scope");
    let (root, change1, change2) = (&oids[0], &oids[2], &oids[4]);
    let read = open(&dir);

    // 以 change1 为起点：只回溯它及更早的历史。
    let scoped = read
        .read_file_history("a.txt", Some(change1.as_str()), None, 50)
        .expect("按提交起点读取");
    let scoped_oids: Vec<&str> = scoped
        .entries
        .iter()
        .map(|entry| entry.commit.oid.as_str())
        .collect();
    assert_eq!(scoped_oids, vec![change1.as_str(), root.as_str()]);

    // 第一页之后 HEAD 前移，旧 cursor 必须立即失效。
    let first = read
        .read_file_history("a.txt", None, None, 1)
        .expect("首页");
    assert_eq!(first.entries.len(), 1);
    assert_eq!(first.entries[0].commit.oid.as_str(), change2.as_str());
    let token = first.next_cursor.expect("仍有更多提交");
    let _moved = commit(&dir, "b.txt", "b1\nmoved\n", "move head");
    let err = read
        .read_file_history("a.txt", None, Some(&token), 1)
        .expect_err("generation 变化后应拒绝旧游标");
    assert_eq!(err.code, ErrorCode::CursorStale);
}

#[test]
fn blame_attributes_each_line_to_its_introducing_commit() {
    let dir = fresh_repo("git-graph-file-blame-lines");
    let first = commit(&dir, "a.rs", "alpha\nbeta\ngamma\n", "init lines");
    let second = commit(&dir, "a.rs", "alpha\nBETA\ngamma\n", "change beta");
    let third = commit(&dir, "a.rs", "alpha\nBETA\ngamma\ndelta\n", "append delta");

    let read = open(&dir);
    let blame = read
        .read_file_blame(&oid_of(&third), "a.rs")
        .expect("读取 blame");
    assert!(!blame.binary && !blame.too_large && !blame.encoding_fallback);
    assert_eq!(blame.oid.as_str(), third);
    assert_eq!(blame.language.as_deref(), Some("rust"));

    let rows: Vec<(u32, &str, &str)> = blame
        .lines
        .iter()
        .map(|line| (line.line_no, line.oid.as_str(), line.content.as_str()))
        .collect();
    assert_eq!(
        rows,
        vec![
            (1, first.as_str(), "alpha"),
            (2, second.as_str(), "BETA"),
            (3, first.as_str(), "gamma"),
            (4, third.as_str(), "delta"),
        ]
    );
    for line in &blame.lines {
        assert_eq!(line.author_name, "Test");
        assert_eq!(line.short_oid, line.oid.as_str()[..7]);
        assert!(line.authored_at > 0);
        assert!(!line.summary.is_empty());
    }
}

#[test]
fn blame_degrades_on_binary_and_oversized_files() {
    let dir = fresh_repo("git-graph-file-blame-degrade");
    std::fs::write(dir.join("bin.dat"), [0u8, 1, 2, 3]).expect("写入二进制文件");
    let big = "a".repeat(MAX_DIFF_BYTES + 1);
    write(&dir.join("big.txt"), &big);
    git_ok(&dir, &["add", "-A"]);
    git_ok(&dir, &["commit", "-m", "binary and big"]);
    let head = oid_of(&read_oid(&dir, "HEAD"));

    let read = open(&dir);
    let binary = read
        .read_file_blame(&head, "bin.dat")
        .expect("二进制 blame");
    assert!(binary.binary);
    assert!(!binary.too_large);
    assert!(binary.lines.is_empty());

    let too_large = read
        .read_file_blame(&head, "big.txt")
        .expect("超大文件 blame");
    assert!(too_large.too_large);
    assert!(!too_large.binary);
    assert!(too_large.lines.is_empty());
}

#[test]
fn sha256_repository_history_and_blame_use_full_length_oids() {
    let set = fixtures();
    let dir = set.sha256();
    let read = open(&dir);
    let head = read_oid(&dir, "HEAD");
    let previous = read_oid(&dir, "HEAD~1");
    assert_eq!(head.len(), 64);

    let page = read
        .read_file_history("sha.txt", None, None, 50)
        .expect("SHA-256 单文件历史");
    let oids: Vec<&str> = page
        .entries
        .iter()
        .map(|entry| entry.commit.oid.as_str())
        .collect();
    assert_eq!(oids, vec![head.as_str(), previous.as_str()]);
    assert!(page
        .entries
        .iter()
        .all(|entry| entry.commit.oid.len() == 64));

    let blame = read
        .read_file_blame(&oid_of(&head), "sha.txt")
        .expect("SHA-256 blame");
    assert_eq!(blame.lines.len(), 2);
    assert_eq!(blame.lines[0].oid.as_str(), previous);
    assert_eq!(blame.lines[1].oid.as_str(), head);
    assert!(blame
        .lines
        .iter()
        .all(|line| line.oid.len() == 64 && line.short_oid.len() == 7));
}

#[test]
fn deleted_path_missing_path_and_empty_path_are_handled() {
    let dir = fresh_repo("git-graph-file-history-errors");
    let root = commit(&dir, "a.txt", "one\n", "root");
    let read = open(&dir);

    let missing = read
        .read_file_blame(&oid_of(&root), "nope.txt")
        .expect_err("缺失路径应报错");
    assert_eq!(missing.code, ErrorCode::FileNotFound);

    let empty = read
        .read_file_history("  ", None, None, 10)
        .expect_err("空路径应报错");
    assert_eq!(empty.code, ErrorCode::InvalidArgument);

    // 删除该文件的提交在历史中显示为 Deleted。
    git_ok(&dir, &["rm", "-q", "a.txt"]);
    git_ok(&dir, &["commit", "-q", "-m", "delete a"]);
    let page = read
        .read_file_history("a.txt", None, None, 10)
        .expect("删除后仍可列历史");
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.entries[0].status, FileStatus::Deleted);
    assert_eq!(page.entries[1].status, FileStatus::Added);
}
