//! 远程操作的 Gate 校验（ADR 0010 §2.3、ADR 0022 分支远程删除）。

use std::collections::BTreeMap;

use git_core::{
    ErrorCode, GateIssueDto, PullMode, Result, UserVisibleError, WriteKind, WriteRequest,
};

use crate::command::HeadInfo;
use crate::status::StatusSummary;
use crate::GitWriteModule;

/// 远程类 Gate 校验结果。
pub(crate) struct RemoteGateResult {
    pub(crate) issues: Vec<GateIssueDto>,
    pub(crate) summary: String,
    pub(crate) summary_key: &'static str,
    pub(crate) summary_args: Option<BTreeMap<String, String>>,
}

/// fetch / pull / push 的 Gate 校验；bare 与中断态由通用前置拒绝。
pub(crate) fn validate_remote(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
    status: &StatusSummary,
) -> Result<RemoteGateResult> {
    let mut issues = Vec::new();
    let branch_ready = !head.detached && head.branch.is_some() && !head.unborn;
    let upstream = if branch_ready {
        module.upstream()?
    } else {
        None
    };

    if request.kind == WriteKind::Fetch && module.remote_count()? == 0 {
        issues.push(issue("gate_remote_missing", "仓库没有配置远程"));
    }

    if request.kind != WriteKind::Fetch {
        if head.unborn {
            issues.push(issue("gate_remote_unborn", "当前分支尚无提交"));
        } else if head.detached || head.branch.is_none() {
            issues.push(issue(
                "gate_remote_detached",
                "detached HEAD 不支持 pull / push，请先切换本地分支",
            ));
        } else if upstream.is_none() {
            issues.push(issue(
                "gate_remote_no_upstream",
                "当前分支没有上游分支，请先在终端设置 upstream",
            ));
        }
    }

    let pull_mode = request.pull_mode.unwrap_or(PullMode::FfOnly);
    if request.kind == WriteKind::Pull
        && (status.staged > 0 || status.tracked > 0 || status.untracked > 0)
    {
        issues.push(issue(
            "gate_remote_dirty_pull",
            match pull_mode {
                PullMode::FfOnly => "工作区不干净；pull --ff-only 前请先提交或 stash",
                PullMode::Merge => "工作区不干净；pull（merge）前请先提交或 stash",
                PullMode::Rebase => "工作区不干净；pull --rebase 前请先提交或 stash",
            },
        ));
    }

    let (summary, summary_key) = match request.kind {
        WriteKind::Fetch => ("将 fetch 远程更新".to_owned(), "errors.gateSummaryFetch"),
        WriteKind::Pull => (
            format!(
                "将 pull{}（{}）{}",
                upstream
                    .as_deref()
                    .map(|u| format!("（{u}）"))
                    .unwrap_or_default(),
                match pull_mode {
                    PullMode::FfOnly => "ff-only",
                    PullMode::Merge => "merge",
                    PullMode::Rebase => "rebase",
                },
                if pull_mode == PullMode::Rebase {
                    "；可用 git rebase --abort 恢复"
                } else {
                    ""
                }
            ),
            "errors.gateSummaryPull",
        ),
        WriteKind::Push => (
            format!(
                "将 push 当前分支{}",
                upstream
                    .as_deref()
                    .map(|u| format!("（{u}）"))
                    .unwrap_or_default()
            ),
            "errors.gateSummaryPush",
        ),
        other => unreachable!("非远程操作进入 remote::gate: {other:?}"),
    };

    Ok(RemoteGateResult {
        issues,
        summary,
        summary_key,
        summary_args: upstream
            .as_deref()
            .and_then(|upstream| args_map(&[("upstream", upstream)])),
    })
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

/// 删除远程分支的 Gate 校验（ADR 0022）：remote 存在且本地缓存里有对应远程跟踪引用。
pub(crate) fn validate_delete_branch_remote(
    module: &GitWriteModule,
    request: &WriteRequest,
) -> Result<RemoteGateResult> {
    let mut issues = Vec::new();
    let branch = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
            .with_key("errors.commandMissingBranch")
    })?;

    if module.remote_count()? == 0 {
        issues.push(issue("gate_remote_missing", "仓库没有配置远程"));
    }
    // 用本地缓存的远程跟踪引用判断存在性；缓存过期时由执行阶段的 Git 报错兜底。
    if !module.remote_ref_exists(&format!("refs/remotes/origin/{branch}"))? {
        issues.push(issue(
            "gate_remote_ref_missing",
            format!(
                "远程没有 origin/{branch}（本地缓存未命中）；如远端确有该分支，请先 fetch 再试"
            ),
        ));
    }

    let summary =
        format!("将删除本地分支 {branch}，并删除远程 origin/{branch}；远程删除影响协作者且不可逆");
    Ok(RemoteGateResult {
        issues,
        summary,
        summary_key: "errors.gateSummaryBranchRemoteDelete",
        summary_args: args_map(&[("branch", branch)]),
    })
}

/// 删除远程标签的 Gate 校验（ADR 0022「标签远程删除」增补）。
///
/// 只要求存在 remote：标签在第一步 `delete_tag` 中已被删除，此时不能再要求本地
/// 标签存在；远端同名标签是否存在由执行阶段的 `remote ref does not exist` 兜底。
pub(crate) fn validate_delete_tag_remote(
    module: &GitWriteModule,
    request: &WriteRequest,
) -> Result<RemoteGateResult> {
    let mut issues = Vec::new();
    let tag = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少标签名")
            .with_key("errors.commandMissingTag")
    })?;

    if tag.is_empty() || tag.starts_with('-') || tag.chars().any(char::is_control) {
        issues.push(issue("gate_invalid_tag_name", "标签名不合法").with_arg("tag", tag));
    }
    if module.remote_count()? == 0 {
        issues.push(issue("gate_remote_missing", "仓库没有配置远程"));
    }

    let summary = format!("将删除远程 origin 上的标签 {tag}；远程删除影响协作者且不可逆");
    Ok(RemoteGateResult {
        issues,
        summary,
        summary_key: "errors.gateSummaryTagRemoteDelete",
        summary_args: args_map(&[("tag", tag)]),
    })
}

fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
