//! worktree porcelain 解析与路径校验的纯函数测试（ADR-0034）。
//!
//! 真实 Git 行为（创建/移除/模板读取）在集成测试 `tests/write_worktree.rs`。

use git_core::WriteKind;

use crate::worktree::gate::path_issue;
use crate::worktree::parse_worktree_list;

const PORCELAIN: &str = "\
worktree /repo/main
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repo/feat
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat

worktree /repo/detached
HEAD 3333333333333333333333333333333333333333
detached

worktree /repo/locked
HEAD 4444444444444444444444444444444444444444
branch refs/heads/locked
locked 迁移中

worktree /repo/prunable
HEAD 5555555555555555555555555555555555555555
branch refs/heads/prunable
prunable gitdir file points to non-existent location

worktree /repo/bare.git
bare
";

#[test]
fn porcelain_parses_main_linked_detached_locked_prunable_and_bare() {
    let entries = parse_worktree_list(PORCELAIN);
    assert_eq!(entries.len(), 6);

    let main = &entries[0];
    assert_eq!(main.path, "/repo/main");
    assert!(main.is_main);
    assert_eq!(main.branch.as_deref(), Some("main"));
    assert!(!main.locked && !main.prunable && !main.detached);
    assert_eq!(
        main.head_oid.as_ref().map(|oid| oid.short(8)),
        Some("11111111")
    );

    assert!(!entries[1].is_main);
    assert_eq!(entries[1].branch.as_deref(), Some("feat"));

    assert!(entries[2].detached);
    assert!(entries[2].branch.is_none());

    assert!(entries[3].locked);
    assert_eq!(entries[3].lock_reason.as_deref(), Some("迁移中"));

    assert!(entries[4].prunable);
    assert!(entries[4].lock_reason.is_none());

    assert!(entries[5].bare);
    assert!(entries[5].branch.is_none());
    assert!(entries[5].head_oid.is_none());
}

#[test]
fn porcelain_skips_unrecognized_lines_and_invalid_blocks() {
    let raw = "\
worktree /repo/main
HEAD not-an-oid
unexpected line
branch refs/heads/main
";
    let entries = parse_worktree_list(raw);
    assert_eq!(entries.len(), 1);
    assert!(entries[0].head_oid.is_none());
    assert_eq!(entries[0].branch.as_deref(), Some("main"));

    // 首行不是 `worktree `：整块跳过，后续合法块仍是主 worktree。
    let raw = "HEAD 1111111111111111111111111111111111111111\n\nworktree /repo/only\n";
    let entries = parse_worktree_list(raw);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "/repo/only");
    assert!(entries[0].is_main);

    assert!(parse_worktree_list("").is_empty());
}

#[test]
fn path_issue_requires_absolute_without_traversal_or_git_dir() {
    assert_eq!(
        path_issue("").map(|issue| issue.code),
        Some("gate_worktree_path_required".to_owned())
    );
    for path in [
        "relative/wt",
        "./wt",
        "C:wt",
        "/repo/../outside",
        "/repo/.git/wt",
        "/repo/ok/.Git/wt",
        "/repo/wt\n",
        " /repo/wt",
    ] {
        let problem = path_issue(path).unwrap_or_else(|| panic!("{path:?} 必须拒绝"));
        assert!(
            problem.code.starts_with("gate_worktree_path_"),
            "{path:?}: {problem:?}"
        );
    }
    // 含空格的合法绝对路径不被误拒。
    let spaced = std::env::temp_dir().join("my worktrees").join("feat");
    assert!(path_issue(&spaced.to_string_lossy()).is_none());
    let plain = std::env::temp_dir().join(".worktrees").join("feat");
    assert!(path_issue(&plain.to_string_lossy()).is_none());
}

#[test]
fn args_are_arrays_with_path_last_or_second_last() {
    use crate::worktree::args_for;
    use git_core::WriteRequest;

    let request = WriteRequest {
        kind: WriteKind::CreateWorktree,
        oid: None,
        branch: Some("feat".to_owned()),
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
        path: Some("/repo/wt/feat".to_owned()),
        hunk_index: None,
        remote: None,
        reset_mode: None,
    };
    assert_eq!(
        args_for(&request).expect("create 参数"),
        ["worktree", "add", "/repo/wt/feat", "feat"]
    );

    let remove = WriteRequest {
        kind: WriteKind::RemoveWorktree,
        branch: None,
        ..request
    };
    assert_eq!(
        args_for(&remove).expect("remove 参数"),
        ["worktree", "remove", "/repo/wt/feat"]
    );
    // 绝不含 --force。
    assert!(!args_for(&remove)
        .expect("remove 参数")
        .iter()
        .any(|arg| arg.contains("force")));
}
