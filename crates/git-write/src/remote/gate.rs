//! 远程操作的 Gate 校验（ADR 0010 §2.3、ADR 0022 分支远程删除、ADR 0028 同步增强）。

use std::collections::BTreeMap;

use git_core::{
    ErrorCode, GateIssueDto, PullMode, Result, UserVisibleError, WriteKind, WriteRequest,
};

use crate::command::HeadInfo;
use crate::remote::{select_remote, RemoteChoice};
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

    // fetch / fetch_prune 只要求存在 remote，不要求当前分支有上游。
    let fetch_like = matches!(request.kind, WriteKind::Fetch | WriteKind::FetchPrune);
    if fetch_like && module.remote_count()? == 0 {
        issues.push(issue("gate_remote_missing", "仓库没有配置远程"));
    }

    if !fetch_like {
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
        WriteKind::FetchPrune => (
            "将 fetch 远程更新，并清理远端已删除分支的本地远程跟踪引用（--prune）".to_owned(),
            "errors.gateSummaryFetchPrune",
        ),
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

/// 首次推送并建立上游（ADR-0028）：当前分支检查 + 尚无上游 + remote 可解析。
pub(crate) fn validate_push_set_upstream(
    module: &GitWriteModule,
    request: &WriteRequest,
    head: &HeadInfo,
) -> Result<RemoteGateResult> {
    let branch = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
            .with_key("errors.commandMissingBranch")
    })?;
    let mut issues = Vec::new();

    if head.unborn {
        issues.push(issue("gate_remote_unborn", "当前分支尚无提交"));
    } else if head.detached || head.branch.is_none() {
        issues.push(issue(
            "gate_remote_detached",
            "detached HEAD 不支持设置上游，请先切换本地分支",
        ));
    } else if head.branch.as_deref() != Some(branch) {
        issues.push(
            issue(
                "gate_push_branch_not_current",
                format!("只能为当前检出的分支建立上游；当前分支不是 {branch}"),
            )
            .with_arg("branch", branch)
            .with_arg("current", head.branch.as_deref().unwrap_or_default()),
        );
    } else if let Some(upstream) = module.upstream()? {
        issues.push(
            issue(
                "gate_push_upstream_exists",
                format!("分支 {branch} 已有上游 {upstream}，请直接使用 Push"),
            )
            .with_arg("branch", branch)
            .with_arg("upstream", upstream),
        );
    }
    if !module.local_branch_exists(branch)? {
        issues.push(
            issue("gate_branch_missing", format!("本地分支 {branch} 不存在"))
                .with_arg("branch", branch),
        );
    }

    let remote = resolve_remote_issue(module, request.remote.as_deref(), &mut issues);
    Ok(RemoteGateResult {
        issues,
        summary: match &remote {
            Some(remote) => format!(
                "将为本地分支 {branch} 建立上游并首次推送到 {remote}/{branch}（git push -u）"
            ),
            None => format!("将为本地分支 {branch} 建立上游并首次推送"),
        },
        summary_key: "errors.gateSummaryPushSetUpstream",
        summary_args: args_map(&[
            ("branch", branch),
            ("remote", remote.as_deref().unwrap_or_default()),
        ]),
    })
}

/// 推送本地标签（ADR-0028）：标签存在 + remote 可解析；不提供 `--force` / `--delete`。
pub(crate) fn validate_push_tag(
    module: &GitWriteModule,
    request: &WriteRequest,
) -> Result<RemoteGateResult> {
    let tag = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少标签名")
            .with_key("errors.commandMissingTag")
    })?;
    let mut issues = Vec::new();

    if crate::tag::gate::invalid_tag_name(module, tag)? {
        issues.push(
            issue(
                "gate_invalid_tag_name",
                "标签名不合法：不能为空、不能以 \"-\" 开头，也不能包含空格或控制字符",
            )
            .with_arg("tag", tag),
        );
    } else if !module.tag_exists(tag)? {
        issues
            .push(issue("gate_tag_missing", format!("本地标签 {tag} 不存在")).with_arg("tag", tag));
    }

    let remote = resolve_remote_issue(module, request.remote.as_deref(), &mut issues);
    Ok(RemoteGateResult {
        issues,
        summary: match &remote {
            Some(remote) => format!("将推送本地标签 {tag} 到远程 {remote}（refs/tags/{tag}）"),
            None => format!("将推送本地标签 {tag} 到远程"),
        },
        summary_key: "errors.gateSummaryTagPush",
        summary_args: args_map(&[
            ("tag", tag),
            ("remote", remote.as_deref().unwrap_or_default()),
        ]),
    })
}

/// 按 ADR-0028 的策略选择 remote；无法唯一确定时把可选列表写进 issue args。
fn resolve_remote_issue(
    module: &GitWriteModule,
    requested: Option<&str>,
    issues: &mut Vec<GateIssueDto>,
) -> Option<String> {
    let available = module.remote_names().unwrap_or_default();
    let options = available.join("、");
    match select_remote(requested, &available) {
        RemoteChoice::Selected(remote) => Some(remote),
        RemoteChoice::Missing => {
            issues.push(issue("gate_remote_missing", "仓库没有配置远程"));
            None
        }
        RemoteChoice::Unknown(remote) => {
            issues.push(
                issue(
                    "gate_remote_unknown",
                    format!("远程 {remote} 未配置；已配置的远程：{options}"),
                )
                .with_arg("remote", remote)
                .with_arg("options", options),
            );
            None
        }
        RemoteChoice::Ambiguous(names) => {
            issues.push(
                issue(
                    "gate_remote_ambiguous",
                    format!("仓库配置了多个远程且没有 origin，请显式指定：{options}"),
                )
                .with_arg("options", names.join("、")),
            );
            None
        }
    }
}

fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
