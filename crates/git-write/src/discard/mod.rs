//! 丢弃未暂存改动与删除未跟踪文件（ADR 0026）。
//!
//! 只做两件事：已跟踪路径用 `git restore --worktree` 从 index 回退工作区（索引不动，
//! 已暂存内容保留）；未跟踪路径逐条做受校验的文件系统删除。不提供全局 `git clean`，
//! 不触碰 ignored 文件与 `.git`，也不删除未跟踪目录。

pub(crate) mod execute;
pub(crate) mod gate;

#[cfg(test)]
mod tests;

use crate::status::StatusEntry;

/// 丢弃请求的分类结果：由服务端按当前 status 判定，前端不声明路径性质。
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct DiscardPlan {
    /// 已跟踪且工作区有改动（`worktree_code != '.'`）；走 `git restore --worktree`。
    pub(crate) tracked: Vec<String>,
    /// 未跟踪条目；逐条删除。
    pub(crate) untracked: Vec<String>,
}

impl DiscardPlan {
    pub(crate) fn total(&self) -> usize {
        self.tracked.len() + self.untracked.len()
    }
}

/// 按当前 status 把请求路径分成 tracked / untracked；不在 status 内的路径被忽略
/// （Gate 已拒绝这类请求，这里只做执行期兜底）。
pub(crate) fn plan(entries: &[StatusEntry], paths: &[String]) -> DiscardPlan {
    let mut plan = DiscardPlan::default();
    for path in paths {
        let Some(entry) = entries.iter().find(|entry| entry.path == *path) else {
            continue;
        };
        if entry.conflicted {
            continue;
        }
        if entry.untracked {
            if !plan.untracked.contains(path) {
                plan.untracked.push(path.clone());
            }
        } else if entry.worktree_code != '.' && !plan.tracked.contains(path) {
            plan.tracked.push(path.clone());
        }
    }
    plan
}

/// `git restore --worktree --pathspec-from-file=- --pathspec-file-nul`：
/// 只重写工作区，索引保持不变；`--worktree` 与 `--pathspec-from-file` 均在 2.30 可用。
pub(crate) fn restore_args() -> Vec<String> {
    vec![
        "restore".to_owned(),
        "--worktree".to_owned(),
        "--pathspec-from-file=-".to_owned(),
        "--pathspec-file-nul".to_owned(),
    ]
}

/// NUL 分隔的 pathspec 字节流；去重由 `plan` 保证。
pub(crate) fn nul_pathspec(paths: &[String]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for path in paths {
        bytes.extend_from_slice(path.as_bytes());
        bytes.push(0);
    }
    bytes
}

/// 首段为 `.git` 的路径一律拒绝；大小写不敏感（Windows 文件系统不区分大小写）。
pub(crate) fn touches_git_dir(path: &str) -> bool {
    path.split('/')
        .next()
        .map(|first| first.eq_ignore_ascii_case(".git"))
        .unwrap_or(false)
}

/// 绝对路径、UNC、盘符与 NUL 的显式拒绝；`safe_rel_path` 之外的平台形态兜底。
pub(crate) fn unsafe_path_shape(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.contains('\0')
        || path.starts_with("//")
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
}
