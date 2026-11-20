//! reset 模块的纯函数与请求约定验证（ADR-0029）。
//!
//! 真正的 Git 行为在集成测试 `tests/write_reset.rs`；这里只钉住命令形态、
//! 模式缺省错误与「硬重置受影响路径」的汇总规则，避免契约在重构中悄悄跑偏。

use git_core::{Oid, ResetMode, WriteKind, WriteRequest};

use crate::reset::{mode_flag, require_mode, require_target, reset_args, working_tree_impact};
use crate::status::{StatusDetail, StatusEntry, StatusSummary};

fn base_request(kind: WriteKind) -> WriteRequest {
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

fn entry(path: &str, index_code: char, worktree_code: char, untracked: bool) -> StatusEntry {
    StatusEntry {
        path: path.to_owned(),
        old_path: None,
        index_code,
        worktree_code,
        untracked,
        conflicted: false,
    }
}

fn detail(entries: Vec<StatusEntry>) -> StatusDetail {
    StatusDetail {
        summary: StatusSummary {
            staged: entries
                .iter()
                .filter(|entry| !entry.untracked && entry.index_code != '.')
                .count() as u32,
            tracked: entries
                .iter()
                .filter(|entry| !entry.untracked && entry.worktree_code != '.')
                .count() as u32,
            untracked: entries.iter().filter(|entry| entry.untracked).count() as u32,
            conflicted: 0,
            conflicted_files: Vec::new(),
        },
        entries,
    }
}

#[test]
fn mode_maps_to_explicit_cli_flag() {
    assert_eq!(mode_flag(ResetMode::Soft), "--soft");
    assert_eq!(mode_flag(ResetMode::Mixed), "--mixed");
    assert_eq!(mode_flag(ResetMode::Hard), "--hard");
}

#[test]
fn args_put_mode_before_full_oid() {
    let oid = Oid::new("0123456789abcdef0123456789abcdef01234567").expect("oid");
    assert_eq!(
        reset_args(ResetMode::Hard, &oid),
        vec![
            "reset".to_owned(),
            "--hard".to_owned(),
            "0123456789abcdef0123456789abcdef01234567".to_owned()
        ]
    );
}

#[test]
fn missing_mode_and_target_are_rejected_with_keys() {
    let request = base_request(WriteKind::Reset);
    let mode = require_mode(&request).expect_err("缺模式必须拒绝");
    assert_eq!(mode.key.as_deref(), Some("errors.resetModeRequired"));
    let target = require_target(&request).expect_err("缺目标必须拒绝");
    assert_eq!(target.key.as_deref(), Some("errors.commandMissingOid"));
}

#[test]
fn impact_counts_sides_and_dedupes_paths() {
    let detail = detail(vec![
        // 同一文件既有暂存又有工作区改动：两侧各计一次，路径只出现一次。
        entry("both.txt", 'M', 'M', false),
        entry("staged.txt", 'A', '.', false),
        entry("dirty.txt", '.', 'M', false),
        entry("new.txt", '?', '?', true),
        // 干净的已跟踪文件不进入清单。
        entry("clean.txt", '.', '.', false),
    ]);
    let impact = working_tree_impact(&detail);
    assert_eq!(impact.staged, 2);
    assert_eq!(impact.tracked, 2);
    assert_eq!(impact.untracked, 1);
    assert_eq!(impact.total(), 4);
    assert_eq!(
        impact.paths,
        vec![
            "both.txt".to_owned(),
            "staged.txt".to_owned(),
            "dirty.txt".to_owned(),
            "new.txt".to_owned()
        ]
    );
}

#[test]
fn impact_is_empty_for_clean_worktree() {
    let impact = working_tree_impact(&detail(vec![entry("clean.txt", '.', '.', false)]));
    assert!(impact.is_empty());
    assert_eq!(impact.total(), 0);
}
