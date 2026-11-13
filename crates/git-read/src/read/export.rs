//! 目录级对比的树遍历（ADR-0025）：把某个提交的完整树按相对路径交给调用方。
//!
//! 只读边界：本模块只遍历对象库，不写文件、不启动子进程、不建 worktree。
//! 落盘由 app 层实现 [`TreeSink`] 完成，临时目录生命周期归 app 层管理。

use std::fmt::Display;

use git_core::{ErrorCode, Oid, Result, UserVisibleError};

use super::GitReadModule;
use crate::util::gix_oid;

/// 接收树的条目；`path` 为 `/` 分隔的相对路径，不含空段与 `..`。
pub trait TreeSink {
    fn entry_dir(&mut self, path: &str) -> Result<()>;
    /// `symlink` 为真时 `data` 是链接目标文本；`executable` 仅对普通文件有意义。
    fn entry_blob(
        &mut self,
        path: &str,
        data: &[u8],
        executable: bool,
        symlink: bool,
    ) -> Result<()>;
}

/// 一次遍历的结果：文件数、字节数与跳过条目数（子模块、平台非法名）。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TreeExport {
    pub files: usize,
    pub bytes: u64,
    pub skipped: usize,
}

impl GitReadModule {
    /// 遍历 `oid` 指向的树，按 Git 顺序把条目交给 `sink`。
    pub fn export_tree(&self, oid: &Oid, sink: &mut dyn TreeSink) -> Result<TreeExport> {
        let repo = self.repo()?;
        let id = gix_oid(oid)?;
        let tree = repo
            .find_object(id)
            .map_err(object_failed)?
            .peel_to_tree()
            .map_err(object_failed)?;
        let mut stats = TreeExport::default();
        walk(&repo, &tree, "", sink, &mut stats)?;
        Ok(stats)
    }
}

fn object_failed(err: impl Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, "读取仓库对象失败")
        .with_key("errors.readTreeExportObjectFailed")
        .with_detail(err.to_string())
}

fn walk(
    repo: &gix::Repository,
    tree: &gix::Tree<'_>,
    prefix: &str,
    sink: &mut dyn TreeSink,
    stats: &mut TreeExport,
) -> Result<()> {
    for entry in tree.iter() {
        let entry = entry.map_err(object_failed)?;
        let name = String::from_utf8_lossy(entry.inner.filename.as_ref()).into_owned();
        if !is_safe_name(&name) {
            stats.skipped += 1;
            continue;
        }
        let path = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        if entry.inner.mode.is_tree() {
            sink.entry_dir(&path)?;
            let sub = repo
                .find_tree(entry.inner.oid.to_owned())
                .map_err(object_failed)?;
            walk(repo, &sub, &path, sink, stats)?;
        } else if entry.inner.mode.is_commit() {
            // 子模块内容不在本仓库对象库内，只保留目录占位。
            sink.entry_dir(&path)?;
            stats.skipped += 1;
        } else {
            let object = repo
                .find_object(entry.inner.oid.to_owned())
                .map_err(object_failed)?
                .detach();
            let executable = entry.inner.mode.value() & 0o111 != 0;
            sink.entry_blob(&path, &object.data, executable, entry.inner.mode.is_link())?;
            stats.files += 1;
            stats.bytes += object.data.len() as u64;
        }
    }
    Ok(())
}

/// 拒绝绝对路径、跨目录与目标平台非法文件名；Git 树条目不含 `/`，但可能含
/// 在 Windows 上被当作分隔符或非法字符的反斜杠、冒号等。
fn is_safe_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name
        .chars()
        .any(|c| c.is_control() || c == '/' || c == '\0')
    {
        return false;
    }
    if cfg!(windows) {
        if name
            .chars()
            .any(|c| matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        {
            return false;
        }
        if name.ends_with([' ', '.']) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsafe_names_are_rejected() {
        for name in ["", ".", "..", "a/b", "a\0b", "a\nb"] {
            assert!(!is_safe_name(name), "{name:?} 不应通过");
        }
        for name in ["README.md", "src", "中文 文件.txt", ".gitignore"] {
            assert!(is_safe_name(name), "{name:?} 应通过");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_illegal_characters_are_rejected() {
        for name in [r"a\b", "a:b", "a*b", "a?b", "a|b"] {
            assert!(!is_safe_name(name), "{name:?} 不应通过");
        }
    }
}
