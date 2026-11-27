use crate::oid::Oid;
use serde::{Deserialize, Serialize};

use super::compare::CompareChangeOrigin;
use super::graph::CommitSummaryDto;
use super::repo::WarningDto;

/* ------------------------------ Commit 详情与 diff ------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    TypeChanged,
    Renamed,
    Copied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFileDto {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub gitlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_oid: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_oid: Option<Oid>,
    /// 对比结果中该文件的改动归属（相对共同祖先）；非对比场景或无共同祖先时为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_origin: Option<CompareChangeOrigin>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffBaselineDto {
    Root,
    FirstParent,
    MergeFirstParent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetailDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub commit: CommitSummaryDto,
    pub message: String,
    pub parents: Vec<Oid>,
    pub files: Vec<ChangedFileDto>,
    pub baseline: DiffBaselineDto,
    /// merge commit 必须以第一父提交为基线，界面据此显示标注。
    pub baseline_note: String,
    pub warnings: Vec<WarningDto>,
    /// 提交对象携带的签名头类型：`gpg` / `ssh` / `x509` / `unknown`；未签名时为 None。
    /// 只表示「有签名头」，不代表验签通过，签名体不透传前端（ADR-0034）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffDto {
    /// 读取结果对应的仓库 generation；前端据此丢弃过期响应。
    pub generation: u64,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
    pub binary: bool,
    pub too_large: bool,
    pub truncated: bool,
    pub encoding_fallback: bool,
    pub gitlink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlink_old: Option<Oid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gitlink_new: Option<Oid>,
    pub additions: u32,
    pub deletions: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// note 对应的降级类型（errors 域 code）；前端按 code+args 本地化，缺失翻译回落 note。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_code: Option<String>,
    /// note 插值参数。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_args: Option<std::collections::BTreeMap<String, String>>,
    /// 旧侧图片预览（`data:<mime>;base64,...`）；仅图片后缀且两侧都不超过 2MB 时提供。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_before: Option<String>,
    /// 新侧图片预览；同上。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_after: Option<String>,
    /// 图片后缀（小写，如 `png`）；仅预览可用时提供，前端据此选择 `<img>` 渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_kind: Option<String>,
}

impl FileDiffDto {
    /// 设置降级说明：中文 note 兜底 + 结构化 code，前端按语言渲染。
    pub fn set_note(&mut self, code: &str, message: impl Into<String>) {
        self.note = Some(message.into());
        self.note_code = Some(code.to_owned());
        self.note_args = None;
    }

    /// 带单个插值参数的降级说明。
    pub fn set_note_arg(
        &mut self,
        code: &str,
        key: &str,
        value: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.note = Some(message.into());
        self.note_code = Some(code.to_owned());
        let args = self.note_args.get_or_insert_with(Default::default);
        args.insert(key.to_owned(), value.into());
    }
}
