//! worktree 写操作的 Gate 校验（ADR-0034 §2）。
//!
//! 只做拒绝与报告：bare 仓库与「存在未完成操作即拒绝」由 `gate.rs` 处理。
//! 创建要求分支存在且未被任何 worktree（含主 worktree）检出，目标必须是绝对路径、
//! 不含 `..`、不在 `.git` 内、父目录存在、目标不存在或为空目录；不自动建父目录。
//! 移除只接受列表中 `is_main == false` 且未锁定的条目，绝不 `--force`。

use std::collections::BTreeMap;
use std::path::{Component, Path};

use git_core::{run_git_output, GateIssueDto, Result, WriteKind, WriteRequest};

use crate::command::HeadInfo;
use crate::GitWriteModule;

/// worktree Gate 的校验结果；`gate.rs` 把它并回 `GateReportDto`。
pub(crate) struct WorktreeGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

pub(crate) fn validate_worktree(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
) -> Result<WorktreeGateResult> {
    let mut issues = Vec::new();
    let path = request.path.as_deref().unwrap_or("");
    if let Some(problem) = path_issue(path) {
        issues.push(problem);
        return Ok(result(
            issues,
            format!("无法处理 worktree 路径 {path}"),
            "errors.gateSummaryWorktreeUnavailable",
            None,
        ));
    }

    match request.kind {
        WriteKind::CreateWorktree => {
            let branch = request.branch.as_deref().unwrap_or("");
            if head.unborn {
                issues.push(issue(
                    "gate_unborn_head",
                    "当前仓库尚无提交，无法创建 worktree",
                ));
            }
            if crate::branch::gate::invalid_ref_name(module, "refs/heads", branch)? {
                issues.push(
                    issue(
                        "gate_invalid_branch_name",
                        "分支名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
                    )
                    .with_arg("branch", branch),
                );
            } else if !module.local_branch_exists(branch)? {
                issues.push(
                    issue(
                        "gate_branch_not_found",
                        format!("本地分支 {branch} 不存在（不会猜测远程跟踪分支）"),
                    )
                    .with_arg("branch", branch),
                );
            } else if let Some(owner) = worktree_branch_owner(module, branch)? {
                issues.push(
                    issue(
                        "gate_branch_checked_out",
                        format!("分支 {branch} 已被 worktree 占用：{owner}"),
                    )
                    .with_arg("branch", branch)
                    .with_arg("path", owner),
                );
            }
            if let Some(problem) = target_fs_issue(path) {
                issues.push(problem);
            }
            Ok(result(
                issues,
                format!("将在 {path} 检出分支 {branch} 创建 worktree"),
                "errors.gateSummaryCreateWorktree",
                Some(args_map(&[("path", path), ("branch", branch)])),
            ))
        }
        WriteKind::RemoveWorktree => {
            let listed = module.list_worktrees()?;
            let entry = listed.iter().find(|entry| same_path(&entry.path, path));
            match entry {
                None => issues.push(
                    issue(
                        "gate_worktree_not_found",
                        format!("路径不在 worktree 列表中：{path}；请刷新后重试"),
                    )
                    .with_arg("path", path),
                ),
                Some(entry) if entry.is_main => issues.push(
                    issue(
                        "gate_worktree_is_main",
                        format!("拒绝移除主 worktree：{path}"),
                    )
                    .with_arg("path", path),
                ),
                Some(entry) if entry.locked => issues.push(
                    issue(
                        "gate_worktree_locked",
                        format!(
                            "worktree {path} 已被锁定{}；请先在终端解锁",
                            entry
                                .lock_reason
                                .as_deref()
                                .map(|reason| format!("（{reason}）"))
                                .unwrap_or_default()
                        ),
                    )
                    .with_arg("path", path),
                ),
                Some(_) => {
                    if let Some(problem) = dirty_issue(path) {
                        issues.push(problem);
                    }
                }
            }
            Ok(result(
                issues,
                format!("将移除 worktree {path}（未提交改动不会被保留）"),
                "errors.gateSummaryRemoveWorktree",
                Some(args_map(&[("path", path)])),
            ))
        }
        other => unreachable!("非 worktree 操作进入 worktree::gate: {other:?}"),
    }
}

/// 路径形态校验（纯函数）：相对路径 / `..` / `.git` 内部 / 控制字符一律拒绝。
pub(crate) fn path_issue(path: &str) -> Option<GateIssueDto> {
    if path.is_empty() {
        return Some(issue("gate_worktree_path_required", "缺少 worktree 路径"));
    }
    if path.chars().any(char::is_control)
        || (path.chars().any(char::is_whitespace) && path.trim() != path)
    {
        return Some(invalid(path, "路径无效：不能包含控制字符或首尾空白"));
    }
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Some(invalid(path, "路径必须是绝对路径"));
    }
    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Some(invalid(path, "路径不能包含 \"..\""));
    }
    if candidate.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(".git")
    }) {
        return Some(
            issue(
                "gate_worktree_path_git_dir",
                format!("拒绝在 .git 内创建 worktree：{path}"),
            )
            .with_arg("path", path),
        );
    }
    None
}

/// 文件系统形态：目标不存在或为空目录，父目录必须存在且是目录；不自动创建。
fn target_fs_issue(path: &str) -> Option<GateIssueDto> {
    let target = Path::new(path);
    match std::fs::metadata(target) {
        Ok(meta) if !meta.is_dir() => Some(
            issue(
                "gate_worktree_target_exists",
                format!("目标已存在且不是目录：{path}"),
            )
            .with_arg("path", path),
        ),
        Ok(_) => {
            let empty = std::fs::read_dir(target)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            (!empty).then(|| {
                issue(
                    "gate_worktree_target_not_empty",
                    format!("目标目录已存在且非空：{path}"),
                )
                .with_arg("path", path)
            })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let parent = target
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty());
            match parent {
                Some(parent) if parent.is_dir() => None,
                Some(parent) => Some(
                    issue(
                        "gate_worktree_parent_missing",
                        format!("父目录不存在或不是目录：{}", parent.display()),
                    )
                    .with_arg("path", parent.display().to_string()),
                ),
                // 盘符根等极端输入交给 Git 判定。
                None => None,
            }
        }
        Err(_) => Some(
            issue(
                "gate_worktree_path_inaccessible",
                format!("目标路径不可访问：{path}"),
            )
            .with_arg("path", path),
        ),
    }
}

/// 目标 worktree 是否干净；Git 会拒绝移除有未提交改动或未跟踪文件的 worktree，
/// 这里提前给出可读提示（`worktree_remove_dirty`），避免执行后才看到 stderr。
fn dirty_issue(path: &str) -> Option<GateIssueDto> {
    let output = run_git_output(
        Some(Path::new(path)),
        &["status", "--porcelain", "--untracked-files=normal"],
        &[("GIT_OPTIONAL_LOCKS", "0"), ("GIT_TERMINAL_PROMPT", "0")],
    )
    .ok()?;
    if !output.status.success() {
        return Some(
            issue(
                "gate_worktree_unavailable",
                format!(
                    "worktree 目录不可访问：{path}；如已手工删除，请在终端执行 git worktree prune"
                ),
            )
            .with_arg("path", path),
        );
    }
    if output
        .stdout
        .iter()
        .any(|byte| *byte != b'\n' && *byte != b'\r')
    {
        return Some(
            issue(
                "worktree_remove_dirty",
                format!(
                    "worktree {path} 存在未提交改动或未跟踪文件，Git 会拒绝移除；请先提交/清理，或在终端处理（本应用不会使用 --force）"
                ),
            )
            .with_arg("path", path),
        );
    }
    None
}

/// 分支是否被某个 worktree 检出（含主 worktree）；返回占用者路径。
fn worktree_branch_owner(module: &GitWriteModule, branch: &str) -> Result<Option<String>> {
    let listed = module.list_worktrees()?;
    Ok(listed
        .iter()
        .find(|entry| entry.branch.as_deref() == Some(branch))
        .map(|entry| entry.path.clone()))
}

/// 路径比较：分隔符与大小写归一后比较，避免前端选择器的写法差异导致漏配。
fn same_path(left: &str, right: &str) -> bool {
    fn normalize(path: &str) -> String {
        path.replace('\\', "/").trim_end_matches('/').to_lowercase()
    }
    normalize(left) == normalize(right)
}

fn invalid(path: &str, reason: &str) -> GateIssueDto {
    issue("gate_worktree_path_invalid", format!("{reason}：{path}")).with_arg("path", path)
}

fn result(
    issues: Vec<GateIssueDto>,
    summary: String,
    summary_key: &'static str,
    summary_args: Option<BTreeMap<String, String>>,
) -> WorktreeGateResult {
    WorktreeGateResult {
        issues,
        summary,
        summary_key,
        summary_args,
    }
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

fn args_map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}
