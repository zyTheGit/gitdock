//! Hunk 级暂存 / 取消暂存 / 丢弃（ADR-0027）。
//!
//! 补丁一律由服务端从**实时 diff** 重新生成：后端跑与 `staging_file_diff` 完全相同的
//! `git diff --no-color --no-ext-diff --unified=3 -M [--cached] -- <path>`（参数由
//! `staging::tracked_diff_args` 统一给出），按输出顺序切成「文件头 + hunk 列表」，只把
//! 文件头与第 `hunk_index` 块喂给 `git apply`。前端从不提供 patch 文本，避免伪造路径
//! 或跨文件注入；`hunk_index` 因此就是 UI 看到的块顺序（0 起始）。

pub(crate) mod execute;
pub(crate) mod gate;
pub(crate) mod patch;

#[cfg(test)]
mod tests;

use git_core::{lossy_text as text, ErrorCode, Result, UserVisibleError, WriteKind, WriteRequest};

use crate::staging::tracked_diff_args;
use crate::status::{StatusDetail, StatusEntry};
use crate::GitWriteModule;

use self::patch::select_hunk;

/// hunk 操作作用的一侧；决定 diff 是否读索引（`--cached`）与 `git apply` 的方向。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HunkSide {
    /// 工作区 → 索引：`git diff` + `git apply --cached`。
    Stage,
    /// 索引 → HEAD：`git diff --cached` + `git apply --cached --reverse`。
    Unstage,
    /// 索引 → 工作区：`git diff` + `git apply --reverse`（破坏性，丢弃工作区改动）。
    Discard,
}

impl HunkSide {
    /// 只接受三个 hunk kind；其他写操作返回 `None`。
    pub(crate) fn from_request(request: &WriteRequest) -> Option<Self> {
        match request.kind {
            WriteKind::StageHunk => Some(Self::Stage),
            WriteKind::UnstageHunk => Some(Self::Unstage),
            WriteKind::DiscardHunk => Some(Self::Discard),
            _ => None,
        }
    }

    /// 取 diff 时是否读索引侧（`--cached`）。
    pub(crate) fn staged(self) -> bool {
        matches!(self, Self::Unstage)
    }

    /// 对应的 `git apply` 参数；补丁经 stdin 传入，保持「参数数组 + 无 shell」约束。
    pub(crate) fn apply_args(self) -> Vec<String> {
        match self {
            Self::Stage => vec!["apply".into(), "--cached".into(), "-".into()],
            Self::Unstage => vec![
                "apply".into(),
                "--cached".into(),
                "--reverse".into(),
                "-".into(),
            ],
            Self::Discard => vec!["apply".into(), "--reverse".into(), "-".into()],
        }
    }

    /// 摘要与文案里的动作名。
    pub(crate) fn verb(self) -> &'static str {
        match self {
            Self::Stage => "暂存",
            Self::Unstage => "取消暂存",
            Self::Discard => "丢弃",
        }
    }
}

/// 请求里的目标路径；Gate 已校验，这里只做执行期兜底。
pub(crate) fn require_path(request: &WriteRequest) -> Result<&str> {
    request
        .path
        .as_deref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            UserVisibleError::new(ErrorCode::InvalidArgument, "缺少 hunk 的目标文件路径")
                .with_key("errors.hunkPathRequired")
        })
}

/// 请求里的 hunk 序号；Gate 已校验范围，这里只做执行期兜底。
pub(crate) fn require_index(request: &WriteRequest) -> Result<u32> {
    request.hunk_index.ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少 hunk 序号")
            .with_key("errors.hunkIndexRequired")
    })
}

/// 在当前 status 中按路径找条目；找不到由调用方决定是 Gate issue 还是错误。
pub(crate) fn find_entry<'a>(detail: &'a StatusDetail, path: &str) -> Option<&'a StatusEntry> {
    detail.entries.iter().find(|entry| entry.path == path)
}

/// 跑与 `staging_file_diff` 相同的 diff 命令，返回原始字节（拆分以字节为准）。
pub(crate) fn live_diff(
    module: &GitWriteModule,
    entry: &StatusEntry,
    side: HunkSide,
) -> Result<Vec<u8>> {
    let args = tracked_diff_args(entry, side.staged());
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = module.run_readonly(&arg_refs)?;
    if !output.status.success() {
        return Err(
            UserVisibleError::new(ErrorCode::GitCommandFailed, "无法生成 hunk 补丁")
                .with_key("errors.hunkDiffFailed")
                .with_arg("path", entry.path.clone())
                .with_detail(text(&output.stderr)),
        );
    }
    Ok(output.stdout)
}

/// `command_for` 的 hunk 分支：重新生成单块补丁并给出 `git apply` 参数。
///
/// 正常执行路径在 `execute` 入口委托 `hunk::execute`，此函数是枚举完备性与
/// 「绕过 execute 直接构造命令」场景的兜底，语义与执行路径一致。
pub(crate) fn command(
    module: &GitWriteModule,
    request: &WriteRequest,
) -> Result<(Vec<String>, Vec<u8>)> {
    let side = HunkSide::from_request(request).ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "不是 hunk 级写操作")
            .with_key("errors.hunkKindInvalid")
    })?;
    let path = require_path(request)?;
    let index = require_index(request)?;
    let detail = module.status_detail()?;
    let entry = find_entry(&detail, path).ok_or_else(|| missing(path))?;
    if entry.untracked || entry.conflicted {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            format!("{path} 不支持 hunk 级操作"),
        )
        .with_key("errors.hunkUntrackedNotSupported")
        .with_arg("path", path));
    }
    let bytes = live_diff(module, entry, side)?;
    let patch = select_hunk(&bytes, index).ok_or_else(|| out_of_range(index, &bytes, path))?;
    Ok((side.apply_args(), patch))
}

/// 目标不在当前 status：过期 UI 或已被外部改动。
pub(crate) fn missing(path: &str) -> UserVisibleError {
    UserVisibleError::new(
        ErrorCode::FileNotFound,
        format!("{path} 当前没有可处理的改动，请刷新后重试"),
    )
    .with_key("errors.hunkNoChanges")
    .with_arg("path", path)
}

/// `hunk_index` 越界：多半是看 diff 期间文件被外部改动，提示刷新而不是把补丁打歪。
pub(crate) fn out_of_range(index: u32, bytes: &[u8], path: &str) -> UserVisibleError {
    UserVisibleError::new(
        ErrorCode::InvalidArgument,
        format!("hunk 序号 {index} 超出 {path} 当前的块数，请刷新 diff 后重试"),
    )
    .with_key("errors.hunkIndexOutOfRange")
    .with_arg("path", path)
    .with_arg("index", index.to_string())
    .with_arg("total", patch::hunk_count(bytes).to_string())
}
