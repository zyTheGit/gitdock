use super::*;

use crate::dto::repo::InterruptionKind;

#[test]
fn legacy_write_request_without_new_fields_deserializes_to_none() {
    // 旧版前端请求只有 kind/oid，新增字段必须按 None 处理，不能导致 IPC 反序列化失败。
    let legacy = r#"{"kind":"cherry_pick","oid":"0123456789abcdef0123456789abcdef01234567"}"#;
    let request: WriteRequest = serde_json::from_str(legacy).expect("旧请求应可反序列化");
    assert_eq!(request.kind, WriteKind::CherryPick);
    assert!(request.interruption.is_none());
    assert!(request.mainline.is_none());
}

#[test]
fn write_request_round_trips_interruption_and_mainline() {
    let request = WriteRequest {
        kind: WriteKind::ContinueOperation,
        oid: None,
        branch: None,
        new_name: None,
        description: None,
        paths: None,
        interruption: Some(InterruptionKind::Revert),
        mainline: Some(2),
        message: None,
        stash: None,
        include_untracked: None,
        pull_mode: None,
        oids: None,
        path: None,
        hunk_index: None,
        remote: None,
        reset_mode: None,
    };
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(json.contains(r#""interruption":"revert""#), "{json}");
    assert!(json.contains(r#""mainline":2"#), "{json}");
    let decoded: WriteRequest = serde_json::from_str(&json).expect("反序列化");
    assert_eq!(decoded.kind, WriteKind::ContinueOperation);
    assert_eq!(decoded.interruption, Some(InterruptionKind::Revert));
    assert_eq!(decoded.mainline, Some(2));

    // None 时不序列化，保持与旧前端契约兼容。
    let minimal = WriteRequest {
        kind: WriteKind::CherryPick,
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
    };
    let json = serde_json::to_string(&minimal).expect("序列化");
    assert!(!json.contains("interruption"), "{json}");
    assert!(!json.contains("mainline"), "{json}");
}

#[test]
fn legacy_gate_report_deserializes_parents_as_empty() {
    let legacy = r#"{"ok":true,"issues":[],"summary":"x","is_merge_commit":false}"#;
    let report: GateReportDto = serde_json::from_str(legacy).expect("旧 Gate 报告应可反序列化");
    assert!(report.parents.is_empty());
    assert!(report.warnings.is_empty());
    assert_eq!(report.affected_total, 0);
    assert!(report.repo_id.is_none());
    assert!(report.generation.is_none());
}

#[test]
fn discard_files_kind_uses_existing_paths_field() {
    // 丢弃复用 paths 字段：旧请求结构不变，只多一个 kind 取值（ADR-0026）。
    let payload = r#"{"kind":"discard_files","paths":["a.txt"]}"#;
    let request: WriteRequest = serde_json::from_str(payload).expect("新请求应可反序列化");
    assert_eq!(request.kind, WriteKind::DiscardFiles);
    assert_eq!(
        request.paths.as_deref(),
        Some(["a.txt".to_owned()].as_slice())
    );
    // 序列化回 snake_case，前端契约与 Rust 枚举一致。
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(json.contains(r#""kind":"discard_files""#), "{json}");
}

#[test]
fn hunk_request_round_trips_path_and_index() {
    // hunk 请求只用 path + hunk_index，不携带任何 patch 文本（ADR-0027）。
    let payload = r#"{"kind":"stage_hunk","path":"src/a.rs","hunk_index":2}"#;
    let request: WriteRequest = serde_json::from_str(payload).expect("hunk 请求应可反序列化");
    assert_eq!(request.kind, WriteKind::StageHunk);
    assert_eq!(request.path.as_deref(), Some("src/a.rs"));
    assert_eq!(request.hunk_index, Some(2));
    assert!(request.paths.is_none());

    let json = serde_json::to_string(&request).expect("序列化");
    assert!(json.contains(r#""kind":"stage_hunk""#), "{json}");
    assert!(json.contains(r#""path":"src/a.rs""#), "{json}");
    assert!(json.contains(r#""hunk_index":2"#), "{json}");

    // 其余两个 kind 同样以 snake_case 出现在契约里。
    for (kind, text) in [
        (WriteKind::UnstageHunk, "unstage_hunk"),
        (WriteKind::DiscardHunk, "discard_hunk"),
    ] {
        let request = WriteRequest {
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
            path: Some("a.txt".to_owned()),
            hunk_index: Some(0),
            remote: None,
            reset_mode: None,
        };
        let json = serde_json::to_string(&request).expect("序列化");
        assert!(json.contains(&format!(r#""kind":"{text}""#)), "{json}");
    }
}

#[test]
fn remote_sync_kinds_round_trip_remote_field() {
    // 远程同步增强（ADR-0028）：四个新 kind + 可选 remote 字段。
    for (kind, text) in [
        (WriteKind::CheckoutRemoteBranch, "checkout_remote_branch"),
        (WriteKind::PushSetUpstream, "push_set_upstream"),
        (WriteKind::FetchPrune, "fetch_prune"),
        (WriteKind::PushTag, "push_tag"),
    ] {
        let payload = format!(r#"{{"kind":"{text}","branch":"origin/feat-a","remote":"origin"}}"#);
        let request: WriteRequest =
            serde_json::from_str(&payload).expect("新 kind 请求应可反序列化");
        assert_eq!(request.kind, kind);
        assert_eq!(request.remote.as_deref(), Some("origin"));
        let json = serde_json::to_string(&request).expect("序列化");
        assert!(json.contains(&format!(r#""kind":"{text}""#)), "{json}");
        assert!(json.contains(r#""remote":"origin""#), "{json}");
    }

    // 旧前端不传 remote 时按 None 处理，且不进入序列化输出。
    let legacy = r#"{"kind":"fetch_prune"}"#;
    let request: WriteRequest = serde_json::from_str(legacy).expect("旧请求应可反序列化");
    assert!(request.remote.is_none());
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(!json.contains("remote"), "{json}");
}

#[test]
fn reset_request_round_trips_mode() {
    // 重置（ADR-0029）：kind 为 snake_case reset，模式三选一。
    for (mode, text) in [
        (ResetMode::Soft, "soft"),
        (ResetMode::Mixed, "mixed"),
        (ResetMode::Hard, "hard"),
    ] {
        let payload = format!(
            r#"{{"kind":"reset","oid":"0123456789abcdef0123456789abcdef01234567","reset_mode":"{text}"}}"#
        );
        let request: WriteRequest = serde_json::from_str(&payload).expect("reset 请求应可反序列化");
        assert_eq!(request.kind, WriteKind::Reset);
        assert_eq!(request.reset_mode, Some(mode));
        assert_eq!(mode.as_str(), text);
        assert_eq!(mode.is_destructive(), mode == ResetMode::Hard);

        let json = serde_json::to_string(&request).expect("序列化");
        assert!(json.contains(r#""kind":"reset""#), "{json}");
        assert!(
            json.contains(&format!(r#""reset_mode":"{text}""#)),
            "{json}"
        );
    }

    // 不带模式（或旧请求）按 None 处理：由 Gate 明确拒绝，而不是替用户猜 soft/mixed/hard。
    let payload = r#"{"kind":"reset","oid":"0123456789abcdef0123456789abcdef01234567"}"#;
    let request: WriteRequest = serde_json::from_str(payload).expect("缺模式应可反序列化");
    assert!(request.reset_mode.is_none());
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(!json.contains("reset_mode"), "{json}");
}

#[test]
fn conflict_kinds_round_trip_single_path() {
    // 冲突解决（ADR-0033）：复用 path 字段，不新增请求字段。
    for (kind, text) in [
        (WriteKind::ResolveConflictOurs, "resolve_conflict_ours"),
        (WriteKind::ResolveConflictTheirs, "resolve_conflict_theirs"),
        (WriteKind::MarkConflictResolved, "mark_conflict_resolved"),
    ] {
        let payload = format!(r#"{{"kind":"{text}","path":"src/a.rs"}}"#);
        let request: WriteRequest =
            serde_json::from_str(&payload).expect("新 kind 请求应可反序列化");
        assert_eq!(request.kind, kind);
        assert_eq!(request.path.as_deref(), Some("src/a.rs"));
        let json = serde_json::to_string(&request).expect("序列化");
        assert!(json.contains(&format!(r#""kind":"{text}""#)), "{json}");
        assert!(json.contains(r#""path":"src/a.rs""#), "{json}");
    }
}

#[test]
fn worktree_kinds_reuse_path_and_branch_fields() {
    // worktree 管理（ADR-0034）：create 用 path（绝对目标）+ branch（源分支）；
    // remove 只用 path；两者都不新增请求字段。
    let create = r#"{"kind":"create_worktree","path":"C:/repo/.worktrees/feat","branch":"feat"}"#;
    let request: WriteRequest = serde_json::from_str(create).expect("create 请求应可反序列化");
    assert_eq!(request.kind, WriteKind::CreateWorktree);
    assert_eq!(request.path.as_deref(), Some("C:/repo/.worktrees/feat"));
    assert_eq!(request.branch.as_deref(), Some("feat"));
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(json.contains(r#""kind":"create_worktree""#), "{json}");
    assert!(json.contains(r#""branch":"feat""#), "{json}");

    let remove = r#"{"kind":"remove_worktree","path":"/abs/wt/feat"}"#;
    let request: WriteRequest = serde_json::from_str(remove).expect("remove 请求应可反序列化");
    assert_eq!(request.kind, WriteKind::RemoveWorktree);
    assert_eq!(request.path.as_deref(), Some("/abs/wt/feat"));
    assert!(request.branch.is_none());
    let json = serde_json::to_string(&request).expect("序列化");
    assert!(json.contains(r#""kind":"remove_worktree""#), "{json}");
    assert!(!json.contains("branch"), "{json}");
}
