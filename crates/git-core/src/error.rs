use serde::{Deserialize, Serialize};
use std::fmt;

/// 稳定错误码。前端按 code 决定交互，不解析 message。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidArgument,
    NotARepository,
    RepositoryNotFound,
    UnsupportedObjectFormat,
    GitVersionTooOld,
    GitMissing,
    CursorInvalid,
    CursorStale,
    RefNotFound,
    RefUnresolved,
    EmptyRepository,
    DetachedHead,
    UnbornHead,
    WorktreeDirty,
    InterruptedState,
    IndexLocked,
    MergeCommitUnsupported,
    BranchNotFound,
    BranchCheckedOut,
    AlreadyOnBranch,
    BareRepository,
    GitCommandFailed,
    NoMergeBase,
    FileNotFound,
    ExternalToolFailed,
    Canceled,
    Io,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserVisibleError {
    pub code: ErrorCode,
    pub message: String,
    /// 原始 stderr 等诊断信息，仅在诊断详情中展示。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// i18n key（`errors.xxx`）；前端优先按 key+args 本地化，缺失翻译时回落 message。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 插值参数（分支名、路径、计数等）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<std::collections::BTreeMap<String, String>>,
}

impl UserVisibleError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
            key: None,
            args: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

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

    pub fn internal(err: impl fmt::Display) -> Self {
        Self::new(ErrorCode::Internal, format!("内部错误：{err}"))
    }
}

impl fmt::Display for UserVisibleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for UserVisibleError {}

pub type Result<T> = std::result::Result<T, UserVisibleError>;
