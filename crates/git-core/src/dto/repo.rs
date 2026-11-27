use crate::oid::{ObjectFormat, Oid};
use serde::{Deserialize, Serialize};

/// 进程内单调递增的仓库会话 id；关闭后不复用（ADR-0032 / ADR-0039）。
pub type RepoId = u64;

/* ------------------------------ 仓库与 ref ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefKind {
    LocalBranch,
    RemoteBranch,
    Tag,
    Head,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefDto {
    /// 完整引用名，例如 `refs/heads/main`。
    pub full_name: String,
    /// 展示名，例如 `main`、`origin/main`、`v1.0`。
    pub short_name: String,
    pub kind: RefKind,
    /// 引用直接指向的对象（annotated tag 为 tag 对象）。
    pub target_oid: Oid,
    /// peel 后的 commit OID；tag 指向非 commit 对象时为 None。
    pub commit_oid: Option<Oid>,
    /// tag 的创建时间（Unix 秒）：annotated tag 取 tagger 时间；轻量 tag 没有真实创建时间，
    /// 回退到指向提交的 committer 时间（与 `git for-each-ref` 的 creatordate 语义一致）。非 tag ref 为 None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    pub is_head: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 本地分支配置的上游展示名（`origin/main`）；未配置上游或非本地分支为 None（ADR-0028）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    /// 本地分支领先上游的提交数；无上游、上游引用缺失或超出扫描上限时为 None（ADR-0028）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ahead: Option<u32>,
    /// 本地分支落后上游的提交数；缺失条件同 `ahead`（ADR-0028）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behind: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeadKind {
    Branch,
    Detached,
    Unborn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeadDto {
    pub kind: HeadKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oid: Option<Oid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterruptionKind {
    Merge,
    CherryPick,
    Revert,
    Rebase,
    Sequencer,
    IndexLock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterruptionDto {
    pub kinds: Vec<InterruptionKind>,
    /// 未合并（冲突）文件路径。
    pub files: Vec<String>,
    /// 面向用户的中文说明。
    pub message: String,
    /// 终端接管提示，禁止本应用自动执行。
    pub terminal_hint: String,
}

impl InterruptionDto {
    pub fn none() -> Self {
        Self {
            kinds: Vec::new(),
            files: Vec::new(),
            message: "无中断操作".into(),
            terminal_hint: String::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        !self.kinds.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoStateDto {
    /// 规范化后的仓库工作区目录；bare 仓库为仓库目录。
    pub path: String,
    pub object_format: ObjectFormat,
    pub head: HeadDto,
    pub refs: Vec<RefDto>,
    pub generation: u64,
    pub is_bare: bool,
    pub is_linked_worktree: bool,
    pub is_shallow: bool,
    pub interruption: InterruptionDto,
    pub git_version: Option<String>,
    pub git_version_supported: bool,
    pub minimum_git_version: String,
    /// 只读打开时的提示（例如 SHA-256 支持状态、shallow 降级）。
    pub warnings: Vec<WarningDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarningDto {
    pub code: String,
    pub message: String,
    /// 插值参数（计数、版本号等）；前端按 code+args 本地化，缺失翻译时回落 message。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<std::collections::BTreeMap<String, String>>,
}

impl WarningDto {
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

/* ------------------------------ 分支 ------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchDescriptionDto {
    pub branch: String,
    pub description: String,
    /// linked worktree 中写入共享 local config，其他 worktree 可见。
    pub shared_across_worktrees: bool,
}

/* ------------------------------ HEAD reflog ------------------------------ */

/// `HEAD` reflog 的一条记录（ADR-0029）。只读视图，不是可写句柄：
/// 前端只能用 `new_oid` 派生「在此创建分支 / cherry-pick」等既有写操作。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflogEntryDto {
    /// 在 reflog 中的序号（0 = 最新），与 `selector` 的 `HEAD@{N}` 一一对应。
    pub index: u32,
    /// `HEAD@{N}` 选择器；由服务端拼好，前端原样展示，不自行拼接。
    pub selector: String,
    /// 变更前对象（引用创建等场景是空哈希，序列化为 `null`）。
    pub old_oid: Option<Oid>,
    /// 变更后对象；引用被删除的空哈希条目不会出现在列表里，因此总是有效 OID。
    pub new_oid: Oid,
    /// Git 原始 reflog 消息（`commit: ...`、`reset: moving to ...`），不翻译。
    pub message: String,
    /// reflog 时间（Unix 秒）。
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflog_entry_serializes_snake_case_with_null_old_oid() {
        // reflog 条目沿用其它 DTO 的 snake_case 字段名（无 rename_all）；
        // 首条记录（引用创建）没有前一个对象，序列化为 null 而不是省略字段。
        let entry = ReflogEntryDto {
            index: 0,
            selector: "HEAD@{0}".to_owned(),
            old_oid: None,
            new_oid: Oid::new("0123456789abcdef0123456789abcdef01234567").expect("oid"),
            message: "reset: moving to 0123456".to_owned(),
            created_at: 1_700_000_000,
        };
        let json = serde_json::to_string(&entry).expect("序列化");
        assert!(json.contains(r#""selector":"HEAD@{0}""#), "{json}");
        assert!(json.contains(r#""old_oid":null"#), "{json}");
        assert!(
            json.contains(r#""new_oid":"0123456789abcdef0123456789abcdef01234567""#),
            "{json}"
        );
        assert!(json.contains(r#""created_at":1700000000"#), "{json}");

        let decoded: ReflogEntryDto = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(decoded.index, 0);
        assert!(decoded.old_oid.is_none());
    }
}
