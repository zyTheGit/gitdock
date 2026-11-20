//! 轻量冲突解决辅助（ADR-0033）。
//!
//! 三个动作都只作用于单个冲突路径：`checkout --ours/--theirs` 只覆盖工作区文件
//! （索引中的冲突条目保持原样，必须再显式 `add` 才算收尾），`add` 把该路径标记为
//! 已解决。绝不自动 continue / abort，也不调用外部合并工具。

pub(crate) mod gate;

#[cfg(test)]
mod tests;

use std::path::Path;

use git_core::{ErrorCode, Result, UserVisibleError, WriteKind, WriteRequest};

/// 残留冲突标记的扫描上限；超过上限按「跳过扫描」处理，不影响 Gate 通过。
pub(crate) const MAX_MARKER_SCAN_BYTES: u64 = 2 * 1024 * 1024;

/// 冲突解决的三个动作；kind → 命令的映射集中在这里。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConflictAction {
    /// `git checkout --ours -- <path>`：取索引 stage 2 一侧覆盖工作区文件。
    Ours,
    /// `git checkout --theirs -- <path>`：取索引 stage 3 一侧覆盖工作区文件。
    Theirs,
    /// `git add -- <path>`：写入 stage 0 条目，标记已解决。
    MarkResolved,
}

impl ConflictAction {
    pub(crate) fn from_kind(kind: WriteKind) -> Option<Self> {
        match kind {
            WriteKind::ResolveConflictOurs => Some(Self::Ours),
            WriteKind::ResolveConflictTheirs => Some(Self::Theirs),
            WriteKind::MarkConflictResolved => Some(Self::MarkResolved),
            _ => None,
        }
    }

    /// 参数数组；路径一律放在 `--` 之后，避免被当作选项。
    pub(crate) fn args(self, path: &str) -> Vec<String> {
        match self {
            Self::Ours => vec![
                "checkout".to_owned(),
                "--ours".to_owned(),
                "--".to_owned(),
                path.to_owned(),
            ],
            Self::Theirs => vec![
                "checkout".to_owned(),
                "--theirs".to_owned(),
                "--".to_owned(),
                path.to_owned(),
            ],
            Self::MarkResolved => vec!["add".to_owned(), "--".to_owned(), path.to_owned()],
        }
    }
}

/// 是否是冲突解决三件套；Gate 用它决定「中断态内执行」的豁免。
pub(crate) fn is_conflict_kind(kind: WriteKind) -> bool {
    ConflictAction::from_kind(kind).is_some()
}

/// 单路径请求的兜底读取：Gate 已校验，这里只防调用方绕过 Gate。
pub(crate) fn require_path(request: &WriteRequest) -> Result<&str> {
    request
        .path
        .as_deref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            UserVisibleError::new(ErrorCode::InvalidArgument, "缺少冲突文件路径")
                .with_key("errors.gateConflictPathRequired")
        })
}

/// 行首的残留冲突标记（`<<<<<<<` / `=======` / `>>>>>>>`）；返回首个命中标记。
///
/// 只做提示：文件里出现恰好以这些字符开头的行（例如文档示例）也会命中，
/// 因此这不是判定「冲突是否已解决」的依据。
pub(crate) fn find_conflict_marker(text: &str) -> Option<&'static str> {
    const MARKERS: [&str; 3] = ["<<<<<<<", "=======", ">>>>>>>"];
    text.lines().find_map(|line| {
        MARKERS
            .iter()
            .copied()
            .find(|marker| line.starts_with(marker))
    })
}

/// 读取工作区文件用于标记扫描。二进制 / 超过上限 / 落在仓库外 / 读失败一律返回
/// `None`（跳过扫描），不把「读不到」误报成「没有残留标记」或错误。
pub(crate) fn read_for_marker_scan(root: &Path, path: &str) -> Option<String> {
    let canonical_root = std::fs::canonicalize(root).ok()?;
    let canonical = std::fs::canonicalize(root.join(path)).ok()?;
    // 符号链接指到仓库外时只读也会绕过仓库边界，直接跳过。
    if !canonical.starts_with(&canonical_root) {
        return None;
    }
    let meta = std::fs::metadata(&canonical).ok()?;
    if !meta.is_file() || meta.len() > MAX_MARKER_SCAN_BYTES {
        return None;
    }
    let bytes = std::fs::read(&canonical).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}
