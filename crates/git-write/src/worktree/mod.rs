//! Worktree 管理与提交模板（ADR-0034）。
//!
//! `git worktree list --porcelain` 与 `git config --get commit.template` 都是子进程，
//! 按架构边界落在这里而不是纯 gix 的 `git-read`。两个查询都是只读的：不经过 Gate、
//! 不持有写锁。创建/移除是白名单写操作，校验在 `gate.rs`，执行在 `execute.rs`。

use std::io::Read;
use std::path::{Path, PathBuf};

use git_core::{
    lossy_text as text, CommitTemplateDto, ErrorCode, Oid, Result, UserVisibleError, WorktreeDto,
    WriteKind, WriteRequest,
};

use crate::GitWriteModule;

pub(crate) mod execute;
pub(crate) mod gate;

#[cfg(test)]
mod tests;

/// `commit.template` 的大小上限；超限按「未配置」处理，不截断内容。
pub(crate) const MAX_TEMPLATE_BYTES: u64 = 64 * 1024;

impl GitWriteModule {
    /// 列出全部 worktree（首条为主 worktree）。命令失败返回空列表，界面保持可用。
    pub fn list_worktrees(&self) -> Result<Vec<WorktreeDto>> {
        let output = self.run_readonly(&["worktree", "list", "--porcelain"])?;
        if !output.status.success() {
            return Ok(Vec::new());
        }
        Ok(parse_worktree_list(&text(&output.stdout)))
    }

    /// 读取仓库配置的 `commit.template`；未配置、文件缺失/不可读/超限均返回 None。
    /// 内容属于用户输入上下文，只用于预填，不写日志。
    pub fn read_commit_template(&self) -> Result<Option<CommitTemplateDto>> {
        let output = self.run_readonly(&["config", "--get", "commit.template"])?;
        if !output.status.success() {
            return Ok(None);
        }
        let raw = text(&output.stdout);
        let configured = raw.trim_end_matches(['\r', '\n']).trim();
        if configured.is_empty() {
            return Ok(None);
        }
        let configured = PathBuf::from(configured);
        // Git 语义：相对路径相对仓库工作区根，绝对路径原样使用。
        let path = if configured.is_absolute() {
            configured
        } else {
            self.root().join(configured)
        };
        let Some(content) = read_template_file(&path) else {
            return Ok(None);
        };
        Ok(Some(CommitTemplateDto {
            path: path.to_string_lossy().into_owned(),
            content,
        }))
    }
}

/// 参数数组构造：create 用 `path` + `branch`，remove 只用 `path`；绝不拼 shell。
pub(crate) fn args_for(request: &WriteRequest) -> Result<Vec<String>> {
    let path = require_path(request)?;
    match request.kind {
        WriteKind::CreateWorktree => {
            let branch = request.branch.as_deref().ok_or_else(|| {
                UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                    .with_key("errors.commandMissingBranch")
            })?;
            Ok(vec![
                "worktree".to_owned(),
                "add".to_owned(),
                path.to_owned(),
                branch.to_owned(),
            ])
        }
        WriteKind::RemoveWorktree => Ok(vec![
            "worktree".to_owned(),
            "remove".to_owned(),
            path.to_owned(),
        ]),
        other => unreachable!("非 worktree 操作进入 worktree::args_for: {other:?}"),
    }
}

/// Gate 与执行共用的路径读取：Gate 已校验，这里只防调用方绕过 Gate。
pub(crate) fn require_path(request: &WriteRequest) -> Result<&str> {
    request
        .path
        .as_deref()
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            UserVisibleError::new(ErrorCode::InvalidArgument, "缺少 worktree 路径")
                .with_key("errors.gateWorktreePathRequired")
        })
}

/// 读取模板文件：必须是常规文件；最多读 `MAX_TEMPLATE_BYTES + 1` 字节判定超限；
/// 非法 UTF-8 走 lossy，任何读取失败都返回 None。
fn read_template_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_TEMPLATE_BYTES {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_TEMPLATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_TEMPLATE_BYTES {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// 解析 `git worktree list --porcelain`：空行分块，首块为主 worktree；
/// 无法识别的行与缺少 `worktree ` 行的块被跳过，绝不让整份列表失败。
pub(crate) fn parse_worktree_list(raw: &str) -> Vec<WorktreeDto> {
    let mut entries: Vec<WorktreeDto> = Vec::new();
    let mut current: Option<WorktreeDto> = None;
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(WorktreeDto {
                path: path.to_owned(),
                head_oid: None,
                branch: None,
                detached: false,
                bare: false,
                is_main: entries.is_empty(),
                locked: false,
                lock_reason: None,
                prunable: false,
            });
            continue;
        }
        // 首行不是 `worktree `：整块不是有效条目，跳过。
        let Some(entry) = current.as_mut() else {
            continue;
        };
        if let Some(value) = line.strip_prefix("HEAD ") {
            entry.head_oid = Oid::new(value.trim()).ok();
        } else if let Some(value) = line.strip_prefix("branch ") {
            let value = value.trim();
            let name = value.strip_prefix("refs/heads/").unwrap_or(value);
            entry.branch = (!name.is_empty()).then(|| name.to_owned());
        } else if line == "detached" {
            entry.detached = true;
        } else if line == "bare" {
            entry.bare = true;
        } else if let Some(reason) = line.strip_prefix("locked ") {
            entry.locked = true;
            entry.lock_reason = non_empty(reason);
        } else if line == "locked" {
            entry.locked = true;
        } else if line
            .strip_prefix("prunable")
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
        {
            // porcelain 只给 prunable 标记与可选原因；原因不进入契约。
            entry.prunable = true;
        }
        // 其他行（未来新增字段）按缺省处理，忽略。
    }
    if let Some(entry) = current.take() {
        entries.push(entry);
    }
    entries
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}
