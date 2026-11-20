//! Hunk 级暂存 / 取消暂存 / 丢弃（ADR-0027）。
//!
//! 覆盖验收标准：多 hunk 文件只动选中块、无尾换行字节精确、越界与非法目标拒绝、
//! 冲突索引与中断态拒绝。`hunk_index` 是 `git diff ... -- <path>` 输出中的 0 起始块序号，
//! 与暂存区 diff 给 UI 的顺序一致。

mod common;

use std::path::Path;

use common::*;
use git_core::{WriteKind, WriteRequest, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo, write};

/// 30 行基准内容；改动点放在第 2、12、22 行，`--unified=3` 下必然切成 3 块。
fn base_content() -> String {
    (1..=30).map(|n| format!("line{n:02}\n")).collect()
}

fn modified_content() -> String {
    base_content()
        .replace("line02\n", "LINE02 changed\n")
        .replace("line12\n", "LINE12 changed\n")
        .replace("line22\n", "LINE22 changed\n")
}

/// 提交基准内容后在工作区写入三块修改。
fn three_hunk_repo() -> (tempfile::TempDir, String) {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "f.txt", &base_content(), "base");
    write(&dir.join("f.txt"), &modified_content());
    (temp, "f.txt".to_owned())
}

fn hunk_request(kind: WriteKind, path: &str, index: u32) -> WriteRequest {
    WriteRequest {
        path: Some(path.to_owned()),
        hunk_index: Some(index),
        ..base_request(kind)
    }
}

fn numstat(dir: &Path, staged: bool) -> String {
    if staged {
        git_ok(dir, &["diff", "--cached", "--numstat"])
    } else {
        git_ok(dir, &["diff", "--numstat"])
    }
}

fn issue_codes(report: &git_core::GateReportDto) -> Vec<String> {
    report
        .issues
        .iter()
        .map(|issue| issue.code.clone())
        .collect()
}

#[test]
fn stage_hunk_stages_only_the_selected_hunk() {
    let (temp, path) = three_hunk_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&hunk_request(WriteKind::StageHunk, &path, 1))
        .expect("暂存第二块");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeHunkStaged"));

    // 索引里只有第 2 块进入暂存；另外两块仍在工作区。
    let staged = git_ok(dir, &["show", ":f.txt"]);
    assert!(staged.contains("LINE12 changed"), "{staged}");
    assert!(!staged.contains("LINE02 changed"), "{staged}");
    assert!(!staged.contains("LINE22 changed"), "{staged}");
    assert_eq!(numstat(dir, true), "1\t1\tf.txt");
    assert_eq!(numstat(dir, false), "2\t2\tf.txt");

    // 工作区内容毫发无损。
    assert_eq!(
        std::fs::read_to_string(dir.join(&path)).expect("工作区文件"),
        modified_content()
    );
    let status = module.staging_status().expect("暂存区状态");
    assert!(status.staged.iter().any(|file| file.path == path));
    assert!(status.unstaged.iter().any(|file| file.path == path));
}

#[test]
fn unstage_hunk_returns_only_the_selected_hunk() {
    let (temp, path) = three_hunk_repo();
    let dir = temp.path();
    git_ok(dir, &["add", &path]);
    let module = GitWriteModule::new(dir).expect("打开写模块");
    assert_eq!(numstat(dir, true), "3\t3\tf.txt");

    let outcome = module
        .execute(&hunk_request(WriteKind::UnstageHunk, &path, 1))
        .expect("取消暂存第二块");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeHunkUnstaged"));

    // 索引回到 HEAD 的第 2 行，另外两块保持已暂存。
    let staged = git_ok(dir, &["show", ":f.txt"]);
    assert!(staged.contains("LINE02 changed"), "{staged}");
    assert!(staged.contains("line12\n"), "{staged}");
    assert!(staged.contains("LINE22 changed"), "{staged}");
    assert_eq!(numstat(dir, true), "2\t2\tf.txt");
    // 只有被退回的那一块出现在未暂存侧。
    assert_eq!(numstat(dir, false), "1\t1\tf.txt");
    assert_eq!(
        std::fs::read_to_string(dir.join(&path)).expect("工作区文件"),
        modified_content()
    );
}

#[test]
fn discard_hunk_restores_only_the_selected_hunk() {
    let (temp, path) = three_hunk_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = hunk_request(WriteKind::DiscardHunk, &path, 1);

    // 破坏性操作：Gate 给出 warning 与受影响的单个路径，供确认框展示。
    let gate = module.validate(&request).expect("Gate");
    assert!(gate.ok, "{gate:?}");
    assert_eq!(gate.affected_paths, vec![path.clone()]);
    assert_eq!(gate.affected_total, 1);
    assert!(gate
        .warnings
        .iter()
        .any(|warning| warning.code == "hunk_discard_destructive"));

    let outcome = module.execute(&request).expect("丢弃第二块");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.key.as_deref(), Some("errors.outcomeHunkDiscarded"));

    // 只有第 2 块被还原，第 1、3 块保留；索引从未被触碰（仍是 HEAD）。
    assert_eq!(
        std::fs::read_to_string(dir.join(&path)).expect("工作区文件"),
        modified_content().replace("LINE12 changed\n", "line12\n")
    );
    assert_eq!(numstat(dir, true), "");
    assert_eq!(numstat(dir, false), "2\t2\tf.txt");
}

#[test]
fn no_trailing_newline_hunk_round_trip_preserves_bytes() {
    let temp = init_temp_repo();
    let dir = temp.path();
    // 基准文件没有结尾换行：diff 里会同时出现 `\ No newline at end of file` 标记。
    commit(dir, "f.txt", "a\nb", "base");
    write(&dir.join("f.txt"), "a\nB");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let path = "f.txt";

    let outcome = module
        .execute(&hunk_request(WriteKind::StageHunk, path, 0))
        .expect("暂存唯一一块");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    // 暂存后未暂存侧为空，说明索引与工作区逐字节一致；再断言工作区内容。
    assert!(!module
        .staging_status()
        .expect("状态")
        .unstaged
        .iter()
        .any(|file| file.path == path));
    assert_eq!(std::fs::read(dir.join(path)).expect("工作区文件"), b"a\nB");

    let outcome = module
        .execute(&hunk_request(WriteKind::UnstageHunk, path, 0))
        .expect("取消暂存唯一一块");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    // 取消暂存后索引回到 HEAD（没有已暂存条目），工作区仍是修改后的内容。
    let status = module.staging_status().expect("状态");
    assert!(!status.staged.iter().any(|file| file.path == path));
    assert!(status.unstaged.iter().any(|file| file.path == path));
    assert_eq!(std::fs::read(dir.join(path)).expect("工作区文件"), b"a\nB");
}

#[test]
fn hunk_index_out_of_range_and_drift_are_rejected() {
    let (temp, path) = three_hunk_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let gate = module
        .validate(&hunk_request(WriteKind::StageHunk, &path, 3))
        .expect("Gate");
    assert!(!gate.ok);
    let out_of_range = gate
        .issues
        .iter()
        .find(|issue| issue.code == "gate_hunk_index_out_of_range")
        .expect("越界应被拒绝");
    assert_eq!(
        out_of_range
            .args
            .as_ref()
            .and_then(|args| args.get("total")),
        Some(&"3".to_owned())
    );
    assert_eq!(
        module
            .execute(&hunk_request(WriteKind::StageHunk, &path, 3))
            .expect("Gate 拒绝")
            .status,
        WriteStatus::Rejected
    );

    // 并发漂移：看 diff 期间工作区被外部改写（块数从 3 变成 1），旧序号必须被拒绝。
    let request = hunk_request(WriteKind::StageHunk, &path, 2);
    assert!(module.validate(&request).expect("Gate").ok);
    write(
        &dir.join(&path),
        &base_content().replace("line02\n", "LINE02 changed\n"),
    );
    let gate = module.validate(&request).expect("Gate");
    assert!(
        issue_codes(&gate)
            .iter()
            .any(|code| code == "gate_hunk_index_out_of_range"),
        "{gate:?}"
    );
    assert_eq!(numstat(dir, true), "");
}

#[test]
fn missing_request_fields_are_rejected() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "f.txt", "base\n", "base");
    write(&dir.join("f.txt"), "changed\n");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let no_path = WriteRequest {
        hunk_index: Some(0),
        ..base_request(WriteKind::StageHunk)
    };
    assert!(issue_codes(&module.validate(&no_path).expect("Gate"))
        .iter()
        .any(|code| code == "gate_hunk_path_required"));

    let no_index = WriteRequest {
        path: Some("f.txt".to_owned()),
        ..base_request(WriteKind::StageHunk)
    };
    assert!(issue_codes(&module.validate(&no_index).expect("Gate"))
        .iter()
        .any(|code| code == "gate_hunk_index_required"));

    // 文件级改动已经做过时，对应一侧没有可操作的 hunk。
    assert!(issue_codes(
        &module
            .validate(&hunk_request(WriteKind::UnstageHunk, "f.txt", 0))
            .expect("Gate")
    )
    .iter()
    .any(|code| code == "gate_nothing_to_unstage"));

    git_ok(dir, &["add", "f.txt"]);
    assert!(issue_codes(
        &module
            .validate(&hunk_request(WriteKind::StageHunk, "f.txt", 0))
            .expect("Gate")
    )
    .iter()
    .any(|code| code == "gate_nothing_to_stage"));
}

#[test]
fn untracked_binary_and_unknown_paths_are_rejected() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    write(&dir.join("new.txt"), "new\n");
    std::fs::write(dir.join("b.bin"), b"\x00\x00\x00").expect("写入二进制基准");
    git_ok(dir, &["add", "b.bin"]);
    git_ok(dir, &["commit", "-m", "binary base"]);
    std::fs::write(dir.join("b.bin"), b"\x00\x00\x00\x00").expect("修改二进制");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    for (path, code) in [
        ("new.txt", "gate_hunk_untracked"),
        ("b.bin", "gate_hunk_binary"),
        ("missing.txt", "gate_path_not_in_status"),
        ("../outside.txt", "gate_invalid_path"),
        ("C:/outside.txt", "gate_invalid_path"),
        (".git/config", "gate_git_dir_path"),
    ] {
        let gate = module
            .validate(&hunk_request(WriteKind::StageHunk, path, 0))
            .expect("Gate");
        assert!(!gate.ok, "{path} 应被拒绝");
        assert!(
            issue_codes(&gate).iter().any(|value| value == code),
            "{path}: {gate:?}"
        );
    }
    // 二进制与未跟踪文件的内容不受影响。
    assert_eq!(
        std::fs::read(dir.join("b.bin")).expect("二进制仍在").len(),
        4
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("new.txt")).expect("未跟踪仍在"),
        "new\n"
    );
}

#[test]
fn unstage_hunk_on_unborn_head_restores_index_entry() {
    let temp = init_temp_repo();
    let dir = temp.path();
    write(&dir.join("f.txt"), "one\ntwo\n");
    git_ok(dir, &["add", "f.txt"]);
    let module = GitWriteModule::new(dir).expect("打开写模块");

    // unborn HEAD：staged diff 相对空树，反向应用后文件回到未跟踪状态。
    let outcome = module
        .execute(&hunk_request(WriteKind::UnstageHunk, "f.txt", 0))
        .expect("取消暂存");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    let status = module.staging_status().expect("状态");
    assert!(status.staged.is_empty(), "{status:?}");
    assert!(status
        .unstaged
        .iter()
        .any(|file| file.path == "f.txt" && file.untracked));
    assert_eq!(
        std::fs::read_to_string(dir.join("f.txt")).expect("工作区文件"),
        "one\ntwo\n"
    );
}

#[test]
fn conflicted_index_and_interruption_are_rejected() {
    let (temp, feature) = conflict_repo();
    let dir = temp.path();
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let picked = module
        .execute(&request(WriteKind::CherryPick, Some(&feature), None, None))
        .expect("cherry-pick");
    assert_eq!(picked.status, WriteStatus::Conflicted, "{picked:?}");
    let before = std::fs::read_to_string(dir.join("conflict.txt")).expect("冲突文件");

    for kind in [WriteKind::StageHunk, WriteKind::DiscardHunk] {
        let outcome = module
            .execute(&hunk_request(kind, "conflict.txt", 0))
            .expect("Gate");
        assert_eq!(outcome.status, WriteStatus::Rejected, "{outcome:?}");
    }
    let gate = module
        .validate(&hunk_request(WriteKind::StageHunk, "conflict.txt", 0))
        .expect("Gate");
    let codes = issue_codes(&gate);
    assert!(
        codes.iter().any(|code| code == "gate_interrupted"),
        "{gate:?}"
    );
    assert!(
        codes
            .iter()
            .any(|code| code == "gate_conflicted_index_hunk"),
        "{gate:?}"
    );
    // 拒绝后冲突标记原样保留。
    assert_eq!(
        std::fs::read_to_string(dir.join("conflict.txt")).expect("冲突文件"),
        before
    );
}
