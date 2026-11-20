//! hunk 模块的纯函数与请求约定验证（ADR-0027）。
//!
//! 真正的 `git apply` 行为在集成测试 `tests/write_hunk.rs`；这里只钉住命令形态、
//! kind → 侧的映射与请求字段的兜底错误，避免契约在重构中悄悄跑偏。

use git_core::{WriteKind, WriteRequest};

use crate::hunk::{require_index, require_path, HunkSide};

fn request(kind: WriteKind, path: Option<&str>, hunk_index: Option<u32>) -> WriteRequest {
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
        path: path.map(str::to_owned),
        hunk_index,
        remote: None,
        reset_mode: None,
    }
}

#[test]
fn kind_maps_to_the_three_sides() {
    assert_eq!(
        HunkSide::from_request(&request(WriteKind::StageHunk, Some("a.txt"), Some(0))),
        Some(HunkSide::Stage)
    );
    assert_eq!(
        HunkSide::from_request(&request(WriteKind::UnstageHunk, Some("a.txt"), Some(0))),
        Some(HunkSide::Unstage)
    );
    assert_eq!(
        HunkSide::from_request(&request(WriteKind::DiscardHunk, Some("a.txt"), Some(0))),
        Some(HunkSide::Discard)
    );
    // 文件级操作没有「侧」，不应被误当作 hunk 请求。
    for kind in [WriteKind::StageFiles, WriteKind::DiscardFiles] {
        assert_eq!(
            HunkSide::from_request(&request(kind, Some("a.txt"), Some(0))),
            None
        );
    }
    assert!(HunkSide::Unstage.staged());
    assert!(!HunkSide::Stage.staged());
    assert!(!HunkSide::Discard.staged());
}

#[test]
fn apply_args_are_stdin_only_and_never_use_unidiff_zero() {
    // stage：写索引；unstage：反向写索引；discard：反向写工作区（无 --cached）。
    assert_eq!(HunkSide::Stage.apply_args(), vec!["apply", "--cached", "-"]);
    assert_eq!(
        HunkSide::Unstage.apply_args(),
        vec!["apply", "--cached", "--reverse", "-"]
    );
    assert_eq!(
        HunkSide::Discard.apply_args(),
        vec!["apply", "--reverse", "-"]
    );
    for side in [HunkSide::Stage, HunkSide::Unstage, HunkSide::Discard] {
        let args = side.apply_args();
        // 标准 3 行上下文是 hunk 契约的一部分：关掉它会让序号语义漂移。
        assert!(!args.iter().any(|arg| arg == "--unidiff-zero"), "{args:?}");
        // 补丁只经 stdin，绝不从地图路径读文件。
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }
}

#[test]
fn request_field_guards_point_at_hunk_keys() {
    let missing_path = require_path(&request(WriteKind::StageHunk, None, Some(0))).unwrap_err();
    assert_eq!(missing_path.key.as_deref(), Some("errors.hunkPathRequired"));

    let empty_path = require_path(&request(WriteKind::StageHunk, Some(""), Some(0))).unwrap_err();
    assert_eq!(empty_path.key.as_deref(), Some("errors.hunkPathRequired"));

    let missing_index = require_index(&request(WriteKind::StageHunk, Some("a.txt"), None));
    assert_eq!(
        missing_index.unwrap_err().key.as_deref(),
        Some("errors.hunkIndexRequired")
    );

    assert_eq!(
        require_path(&request(WriteKind::StageHunk, Some("a.txt"), Some(0))).unwrap(),
        "a.txt"
    );
    assert_eq!(
        require_index(&request(WriteKind::StageHunk, Some("a.txt"), Some(2))).unwrap(),
        2
    );
}
