use crate::oid::Oid;
use serde::{Deserialize, Serialize};

use super::diff::FileStatus;
use super::repo::{HeadDto, InterruptionDto, InterruptionKind, WarningDto};

/* ------------------------------ 写操作 ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteKind {
    CherryPick,
    Revert,
    SwitchBranch,
    SetBranchDescription,
    StageFiles,
    UnstageFiles,
    ContinueOperation,
    AbortOperation,
    CreateCommit,
    AmendCommit,
    CreateBranch,
    DeleteBranch,
    DeleteBranchRemote,
    RenameBranch,
    CreateTag,
    DeleteTag,
    DeleteTagRemote,
    SetTagDescription,
    StashSave,
    StashApply,
    StashPop,
    StashDrop,
    Fetch,
    Pull,
    Push,
    Merge,
    Rebase,
    /// 丢弃所选路径的未暂存改动；未跟踪路径按删除处理（ADR-0026）。
    DiscardFiles,
    /// 暂存 `path` 的第 `hunk_index` 块未暂存改动（ADR-0027）。
    StageHunk,
    /// 取消暂存 `path` 的第 `hunk_index` 块已暂存改动（ADR-0027）。
    UnstageHunk,
    /// 丢弃 `path` 工作区中的第 `hunk_index` 块改动（ADR-0027，破坏性）。
    DiscardHunk,
    /// 把远程跟踪分支（`branch` = `origin/feat-a`）检出为跟踪该远程分支的本地分支（ADR-0028）。
    CheckoutRemoteBranch,
    /// 为当前本地分支建立上游并首次推送：`git push -u <remote> <branch>`（ADR-0028）。
    PushSetUpstream,
    /// `git fetch --prune`：fetch 并清理远端已删除分支的本地远程跟踪引用（ADR-0028）。
    FetchPrune,
    /// 推送本地标签到远程：`git push <remote> refs/tags/<tag>`（ADR-0028）。
    PushTag,
    /// 把当前分支重置到 `oid`（`git reset --soft|--mixed|--hard`，模式由 `reset_mode` 给出，ADR-0029）。
    Reset,
    /// `git checkout --ours -- <path>`：用一侧内容覆盖冲突文件的工作区版本，不暂存（ADR-0033）。
    ResolveConflictOurs,
    /// `git checkout --theirs -- <path>`：同上，取另一侧；rebase 下两侧语义反转（ADR-0033）。
    ResolveConflictTheirs,
    /// `git add -- <path>`：把当前 conflicted 路径标记为已解决（ADR-0033）。
    MarkConflictResolved,
    /// `git worktree add <path> <branch>`：在绝对路径 `path` 检出本地分支 `branch`（ADR-0034）。
    CreateWorktree,
    /// `git worktree remove <path>`：移除绝对路径 `path` 的 linked worktree，绝不 `--force`（ADR-0034）。
    RemoveWorktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullMode {
    FfOnly,
    Merge,
    Rebase,
}

/// reset 的模式，对应 `git reset --soft|--mixed|--hard`（ADR-0029）。
///
/// 契约层只描述语义与破坏性，命令行开关由 git-write 映射，git-core 不知道 CLI 细节。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetMode {
    /// 只移动分支指针：索引与工作区都不动，原先未提交的改动保持原样。
    Soft,
    /// 移动分支指针并重置索引：已暂存改动退回工作区未暂存（Git 默认行为）。
    Mixed,
    /// 移动分支指针并重置索引与工作区：已暂存与已跟踪改动被永久丢弃（未跟踪文件不受影响）。
    Hard,
}

impl ResetMode {
    /// 契约里的 snake_case 名称，同时用作 i18n 插值参数。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Soft => "soft",
            Self::Mixed => "mixed",
            Self::Hard => "hard",
        }
    }

    /// 是否破坏性模式；Gate warning 与前端强确认都以此为依据。
    pub fn is_destructive(self) -> bool {
        matches!(self, Self::Hard)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteRequest {
    pub kind: WriteKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// rename_branch 的新分支名；其他操作忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// stage/unstage/discard 的文件路径（仓库内相对路径）；其他操作忽略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    /// 继续/中止时指定的中断类型；必须与探测到的标记严格一致。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interruption: Option<InterruptionKind>,
    /// merge commit 的基线父序号（1 起始）；非 merge commit 不得提供。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mainline: Option<u32>,
    /// create_commit / amend_commit 的提交消息；其他操作忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// stash_save / stash_apply / stash_pop / stash_drop 的 `stash@{N}` 选择器。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stash: Option<String>,
    /// stash_save 是否包含未跟踪文件；缺省 false。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_untracked: Option<bool>,
    /// pull 的模式；缺省 ff_only。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_mode: Option<PullMode>,
    /// 批量 cherry-pick / revert 的提交列表；提供时优先于 oid。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oids: Option<Vec<Oid>>,
    /// stage_hunk / unstage_hunk / discard_hunk 的目标文件（仓库内相对路径）；
    /// worktree 类操作的目标目录（绝对 OS 路径）；其他操作忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// hunk 在 `git diff ... -- <path>` 输出中的 0 起始序号（与暂存区 diff 的块顺序一致）；
    /// 只对 stage_hunk / unstage_hunk / discard_hunk 生效，一次请求只处理一块（ADR-0027）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk_index: Option<u32>,
    /// push_set_upstream / push_tag 的目标 remote；缺省按「origin → 唯一配置的 remote」选择，
    /// 多 remote 且无 origin 时 Gate 要求显式提供（ADR-0028）。其他操作忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
    /// reset 的模式；`reset` 必须显式提供（Gate 拒绝缺省），其他操作忽略（ADR-0029）。
    /// 旧请求体里没有该字段，反序列化为 None 不影响其它 kind。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_mode: Option<ResetMode>,
}

/// 单条本地 stash：index 0 为最新；selector 形如 `stash@{0}`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashEntryDto {
    pub index: u32,
    pub selector: String,
    pub oid: Oid,
    /// Git reflog 原始消息，不翻译。
    pub message: String,
    /// reflog 时间（Unix 秒）。
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateIssueDto {
    pub code: String,
    pub message: String,
    /// 插值参数（分支名、计数等）；前端按 code+args 本地化，缺失翻译时回落 message。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<std::collections::BTreeMap<String, String>>,
}

impl GateIssueDto {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            args: None,
        }
    }

    /// 带单个插值参数；多参数链式调用多次即可。
    pub fn with_arg(mut self, key: &str, value: impl Into<String>) -> Self {
        let args = self.args.get_or_insert_with(Default::default);
        args.insert(key.to_owned(), value.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentOptionDto {
    pub oid: Oid,
    pub short_oid: String,
    pub summary: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GateReportDto {
    pub ok: bool,
    pub issues: Vec<GateIssueDto>,
    /// 不阻断执行的提示，例如切换分支时工作区改动会被保留。
    #[serde(default)]
    pub warnings: Vec<WarningDto>,
    /// 受影响的工作区文件（最多 `MAX_AFFECTED_PATHS` 条）。
    #[serde(default)]
    pub affected_paths: Vec<String>,
    /// 受影响文件总数；大于 `affected_paths.len()` 表示清单被截断。
    #[serde(default)]
    pub affected_total: usize,
    /// 用于确认框展示的摘要。
    pub summary: String,
    /// 摘要对应的 i18n key；前端优先按 key+args 本地化，缺失翻译时回落 summary。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_key: Option<String>,
    /// 摘要插值参数（操作名、分支名、计数等）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_args: Option<std::collections::BTreeMap<String, String>>,
    pub is_merge_commit: bool,
    /// 提交的父提交列表，顺序与 `git cherry-pick -m N` 的 1 起始父序号一致。
    #[serde(default)]
    pub parents: Vec<ParentOptionDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteStatus {
    Succeeded,
    EmptyPick,
    Conflicted,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteOutcomeDto {
    pub status: WriteStatus,
    pub message: String,
    /// i18n key（`errors.xxx`）；前端优先按 key+args 本地化，缺失翻译时回落 message。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 插值参数（分支名、计数等）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<std::collections::BTreeMap<String, String>>,
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    pub conflict_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption: Option<InterruptionDto>,
    /// 操作后重新探测到的 generation；前端仅在仍匹配时刷新。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<Oid>,
}

impl WriteOutcomeDto {
    /// 标注 i18n key；message 保留为无翻译语言下的兜底文案。
    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    /// 带单个插值参数；多参数链式调用多次即可。
    pub fn with_arg(mut self, key: &str, value: impl Into<String>) -> Self {
        let args = self.args.get_or_insert_with(Default::default);
        args.insert(key.to_owned(), value.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStatusDto {
    pub dirty: bool,
    pub staged: u32,
    pub tracked: u32,
    pub untracked: u32,
    pub conflicted: u32,
    pub is_bare: bool,
    pub detached: bool,
}

/* ------------------------------ 暂存区 ------------------------------ */

/// 暂存区中的一个文件条目；同一路径可能同时出现在 staged 与 unstaged 列表中。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagingFileDto {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    /// porcelain v2 的 index 侧状态字母；未跟踪条目为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_code: Option<String>,
    /// porcelain v2 的 worktree 侧状态字母；未跟踪条目为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_code: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub gitlink: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagingStatusDto {
    pub generation: u64,
    pub head: HeadDto,
    pub unborn: bool,
    pub detached: bool,
    pub is_bare: bool,
    pub staged: Vec<StagingFileDto>,
    pub unstaged: Vec<StagingFileDto>,
    /// 未解决冲突文件；暂存区对冲突文件禁用 stage/unstage。
    pub conflicted_files: Vec<String>,
    pub warnings: Vec<WarningDto>,
}

#[cfg(test)]
mod tests {
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
            let payload =
                format!(r#"{{"kind":"{text}","branch":"origin/feat-a","remote":"origin"}}"#);
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
            let request: WriteRequest =
                serde_json::from_str(&payload).expect("reset 请求应可反序列化");
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
        let create =
            r#"{"kind":"create_worktree","path":"C:/repo/.worktrees/feat","branch":"feat"}"#;
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
}
