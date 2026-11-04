//! 写前 Gate：白名单操作的校验规则与 Gate 报告组装。

use std::collections::BTreeMap;

use git_core::{
    kind_names, ErrorCode, GateIssueDto, GateReportDto, InterruptionKind, Result, UserVisibleError,
    WarningDto, WriteKind, WriteRequest,
};

use crate::description::validate_branch_description;
use crate::staging::{safe_rel_path, MAX_STAGING_PATHS};
use crate::status::{StatusEntry, StatusSummary};
use crate::GitWriteModule;

/// Gate 报告中受影响文件清单的上限；超出部分由 `affected_total` 说明。
const MAX_AFFECTED_PATHS: usize = 50;

impl GitWriteModule {
    /// 写前 Gate。`issues` 非空即拒绝执行；summary 用于确认框。
    pub fn validate(&self, request: &WriteRequest) -> Result<GateReportDto> {
        let mut issues = Vec::new();
        let mut warnings = Vec::new();
        let mut affected_paths = Vec::new();
        let mut affected_total = 0usize;
        let mut is_merge_commit = false;
        let mut parent_options = Vec::new();

        if self.is_bare()? {
            issues.push(issue(
                "gate_bare_repository",
                "bare 仓库不提供写操作，请使用工作区仓库或命令行",
            ));
            return Ok(GateReportDto {
                ok: false,
                issues,
                warnings,
                affected_paths,
                affected_total,
                summary: "bare 仓库不支持写操作".into(),
                summary_key: Some("errors.gateSummaryBare".into()),
                summary_args: None,
                is_merge_commit,
                parents: parent_options,
            });
        }

        let continues_interruption = matches!(
            request.kind,
            WriteKind::ContinueOperation | WriteKind::AbortOperation
        );

        // 继续/中止本身就是收尾中断态，只有其他操作才沿用「存在未完成操作即拒绝」。
        let interruption = self.inspect_interruption()?;
        if !continues_interruption && interruption.is_active() {
            let kinds_text = kind_names(&interruption.kinds);
            let hint_text = interruption.terminal_hint;
            issues.push(
                issue(
                    "gate_interrupted",
                    format!("存在未完成的 Git 操作：{kinds_text}；{hint_text}"),
                )
                .with_arg("kinds", kinds_text)
                .with_arg("hint", hint_text),
            );
        }
        if !continues_interruption && request.interruption.is_some() {
            issues.push(issue(
                "gate_interruption_not_applicable",
                "只有继续/中止操作可以指定中断类型",
            ));
        }

        let head = self.head_kind()?;
        let detail = self.status_detail()?;
        let status = &detail.summary;

        let (summary, summary_key, summary_args) = match request.kind {
            WriteKind::CherryPick | WriteKind::Revert => {
                let oid = request.oid.as_ref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
                        .with_key("errors.commandMissingOid")
                })?;
                let parent_oids = self.commit_parents(oid.as_str())?;
                is_merge_commit = parent_oids.len() > 1;
                // 父提交列表按 `-m` 的 1 起始顺序给出，供前端选择基线父。
                parent_options = self.parent_options(&parent_oids)?;
                let parent_count = parent_oids.len() as u32;
                if is_merge_commit {
                    match request.mainline {
                        None => issues.push(
                            issue(
                                "gate_mainline_required",
                                format!(
                                    "该提交是 merge commit（共 {parent_count} 个父提交），必须选择基线父提交（-m N）"
                                ),
                            )
                            .with_arg("n", parent_count.to_string()),
                        ),
                        Some(n) if n == 0 || n > parent_count => issues.push(
                            issue(
                                "gate_mainline_invalid",
                                format!("基线父序号必须在 1..={parent_count} 之间"),
                            )
                            .with_arg("n", parent_count.to_string()),
                        ),
                        Some(_) => {}
                    }
                } else if request.mainline.is_some() {
                    issues.push(issue(
                        "gate_mainline_not_applicable",
                        "该提交不是 merge commit，不能指定基线父提交（-m）",
                    ));
                }
                if head.detached {
                    issues.push(issue(
                        "gate_detached_head",
                        "当前处于 detached HEAD，拒绝写操作",
                    ));
                }
                if head.unborn {
                    issues.push(issue("gate_unborn_head", "当前分支尚无提交，拒绝写操作"));
                }
                if status.staged > 0 || status.tracked > 0 || status.untracked > 0 {
                    issues.push(dirty_issue(status));
                }
                let action = if request.kind == WriteKind::CherryPick {
                    "cherry-pick"
                } else {
                    "revert"
                };
                let branch = head.branch.as_deref().unwrap_or("（未知分支）");
                let short = short_oid(oid.as_str());
                match request.mainline {
                    Some(n) if is_merge_commit && n >= 1 && n <= parent_count => (
                        format!(
                            "将 {action} {short} 到当前分支 {branch}，以第 {n} 父提交为基线（{n}/{parent_count}）"
                        ),
                        "errors.gateSummaryCherryPickWithBase",
                        args_map(&[
                            ("action", action),
                            ("oid", short),
                            ("branch", branch),
                            ("n", &n.to_string()),
                            ("total", &parent_count.to_string()),
                        ]),
                    ),
                    _ => (
                        format!("将 {action} {short} 到当前分支 {branch}"),
                        "errors.gateSummaryCherryPick",
                        args_map(&[("action", action), ("oid", short), ("branch", branch)]),
                    ),
                }
            }
            WriteKind::SwitchBranch => {
                let branch = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                if head.unborn {
                    issues.push(issue(
                        "gate_unborn_head_switch",
                        "当前分支尚无提交，无法切换",
                    ));
                }
                if head.detached {
                    issues.push(issue(
                        "gate_detached_head_switch",
                        "detached HEAD 状态不支持切换，请先用命令行处理",
                    ));
                }
                if status.conflicted > 0 {
                    issues.push(
                        issue(
                            "gate_conflicted_index_switch",
                            format!(
                                "索引中还有 {} 个未解决冲突文件，请先在终端解决后再切换分支",
                                status.conflicted
                            ),
                        )
                        .with_arg("n", status.conflicted.to_string()),
                    );
                }
                if status.staged > 0 || status.tracked > 0 || status.untracked > 0 {
                    let dirty_files: Vec<&StatusEntry> = detail
                        .entries
                        .iter()
                        .filter(|entry| !entry.conflicted)
                        .collect();
                    affected_total = dirty_files.len();
                    affected_paths = dirty_files
                        .iter()
                        .take(MAX_AFFECTED_PATHS)
                        .map(|entry| entry.path.clone())
                        .collect();
                    warnings.push(
                        WarningDto::new(
                            "worktree_dirty",
                            format!(
                                "工作区有 {affected_total} 个文件存在改动（{}）。不会自动 stash、reset 或 clean：改动会保留在工作区并可能带到目标分支；若目标分支会覆盖这些文件，Git 将拒绝切换并保持现状。",
                                dirty_parts(status)
                            ),
                        )
                        .with_arg("total", affected_total.to_string())
                        .with_arg("parts", dirty_parts(status)),
                    );
                }
                if !self.local_branch_exists(branch)? {
                    issues.push(
                        issue(
                            "gate_branch_not_found",
                            format!("本地分支 {branch} 不存在（不会猜测远程跟踪分支）"),
                        )
                        .with_arg("branch", branch),
                    );
                } else {
                    if head.branch.as_deref() == Some(branch) {
                        issues.push(
                            issue("gate_already_on_branch", format!("已经在分支 {branch} 上"))
                                .with_arg("branch", branch),
                        );
                    }
                    if let Some(path) = self.worktree_owner(branch, head.branch.as_deref())? {
                        issues.push(
                            issue(
                                "gate_branch_checked_out",
                                format!("分支 {branch} 已被其他 worktree 占用：{path}"),
                            )
                            .with_arg("branch", branch)
                            .with_arg("path", path),
                        );
                    }
                }
                if affected_total > 0 {
                    (
                        format!(
                            "将切换到本地分支 {branch}；{affected_total} 个有改动的文件会保留在工作区"
                        ),
                        "errors.gateSummarySwitchWithChanges",
                        args_map(&[("branch", branch), ("n", &affected_total.to_string())]),
                    )
                } else {
                    (
                        format!("将切换到本地分支 {branch}"),
                        "errors.gateSummarySwitch",
                        args_map(&[("branch", branch)]),
                    )
                }
            }
            WriteKind::SetBranchDescription => {
                let branch = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                if !self.local_branch_exists(branch)? {
                    issues.push(
                        issue("gate_branch_missing", format!("本地分支 {branch} 不存在"))
                            .with_arg("branch", branch),
                    );
                }
                if let Some(description) = request.description.as_deref() {
                    // 写前即校验值，前端在 Gate 阶段就能收到错误。
                    validate_branch_description(description)?;
                }
                (
                    format!("将更新分支 {branch} 的本地描述"),
                    "errors.gateSummaryDescription",
                    args_map(&[("branch", branch)]),
                )
            }
            WriteKind::StageFiles | WriteKind::UnstageFiles => {
                let staging = request.kind == WriteKind::StageFiles;
                let paths = request.paths.as_deref().unwrap_or(&[]);
                if paths.is_empty() {
                    issues.push(issue("gate_paths_required", "请选择要处理的文件"));
                }
                if paths.len() > MAX_STAGING_PATHS {
                    issues.push(
                        issue(
                            "gate_too_many_paths",
                            format!("一次最多处理 {MAX_STAGING_PATHS} 个文件"),
                        )
                        .with_arg("max", MAX_STAGING_PATHS.to_string()),
                    );
                }
                for path in paths {
                    if !safe_rel_path(path) {
                        issues.push(
                            issue("gate_invalid_path", format!("路径无效：{path}"))
                                .with_arg("path", path),
                        );
                        continue;
                    }
                    match detail.entries.iter().find(|entry| entry.path == *path) {
                        None => issues.push(
                            issue(
                                "gate_path_not_in_status",
                                format!("{path} 当前没有可处理的变更，请刷新后重试"),
                            )
                            .with_arg("path", path),
                        ),
                        Some(entry) if entry.conflicted => issues.push(
                            issue(
                                "gate_conflicted_file",
                                format!("{path} 存在未解决冲突，请在终端处理"),
                            )
                            .with_arg("path", path),
                        ),
                        Some(entry) => {
                            let has_worktree = entry.untracked || entry.worktree_code != '.';
                            let has_index = !entry.untracked && entry.index_code != '.';
                            if staging && !has_worktree {
                                issues.push(
                                    issue(
                                        "gate_nothing_to_stage",
                                        format!("{path} 没有未暂存改动"),
                                    )
                                    .with_arg("path", path),
                                );
                            }
                            if !staging && !has_index {
                                issues.push(
                                    issue(
                                        "gate_nothing_to_unstage",
                                        format!("{path} 没有已暂存改动"),
                                    )
                                    .with_arg("path", path),
                                );
                            }
                        }
                    }
                }
                if detail.summary.conflicted > 0 {
                    issues.push(issue(
                        "gate_conflicted_index_stage",
                        "存在未解决的冲突文件，请先在终端处理后再暂存",
                    ));
                }
                if staging {
                    (
                        format!("将暂存 {} 个文件", paths.len()),
                        "errors.gateSummaryStage",
                        args_map(&[("n", &paths.len().to_string())]),
                    )
                } else {
                    (
                        format!("将取消暂存 {} 个文件", paths.len()),
                        "errors.gateSummaryUnstage",
                        args_map(&[("n", &paths.len().to_string())]),
                    )
                }
            }
            WriteKind::CreateCommit | WriteKind::AmendCommit => {
                // 提交校验按 ADR 0007 拆到 commit 模块；bare 与中断态已由上方前置拒绝。
                let commit = crate::commit::gate::validate_commit(self, request, &head, status)?;
                issues.extend(commit.issues);
                (commit.summary, commit.summary_key, commit.summary_args)
            }
            WriteKind::CreateBranch | WriteKind::DeleteBranch | WriteKind::RenameBranch => {
                // 分支校验按 ADR 0008 拆到 branch 模块；bare 与中断态已由上方前置拒绝。
                let change = crate::branch::gate::validate_branch_change(self, request, &head)?;
                issues.extend(change.issues);
                (change.summary, change.summary_key, change.summary_args)
            }
            WriteKind::CreateTag | WriteKind::DeleteTag => {
                // 标签校验按 ADR 0008 拆到 tag 模块；bare 与中断态已由上方前置拒绝。
                let change = crate::tag::gate::validate_tag_change(self, request, &head)?;
                issues.extend(change.issues);
                (change.summary, change.summary_key, change.summary_args)
            }
            WriteKind::StashSave
            | WriteKind::StashApply
            | WriteKind::StashPop
            | WriteKind::StashDrop => {
                // stash 校验按 ADR 0009 拆到 stash 模块；bare 与中断态已由上方前置拒绝。
                let change = crate::stash::gate::validate_stash_change(self, request, status)?;
                issues.extend(change.issues);
                (change.summary, change.summary_key, change.summary_args)
            }
            WriteKind::ContinueOperation | WriteKind::AbortOperation => {
                let continuing = request.kind == WriteKind::ContinueOperation;
                let verb = if continuing { "继续" } else { "中止" };
                let verb_name = if continuing { "continue" } else { "abort" };
                let pick = match request.interruption {
                    Some(InterruptionKind::CherryPick) => Some(("cherry-pick", "CHERRY_PICK_HEAD")),
                    Some(InterruptionKind::Revert) => Some(("revert", "REVERT_HEAD")),
                    Some(_) => {
                        issues.push(issue(
                            "gate_interruption_invalid",
                            "继续/中止只支持 cherry-pick 或 revert 中断",
                        ));
                        None
                    }
                    None => {
                        issues.push(
                            issue(
                                "gate_interruption_required",
                                format!("{verb}操作需要指定中断类型（cherry_pick 或 revert）"),
                            )
                            .with_arg("verb", verb_name),
                        );
                        None
                    }
                };
                let mut summary = format!("无法{verb}当前操作");
                let mut summary_key = if continuing {
                    "errors.gateSummaryContinueUnavailable"
                } else {
                    "errors.gateSummaryAbortUnavailable"
                };
                let mut summary_args: Option<BTreeMap<String, String>> = None;
                if let Some((action, marker)) = pick {
                    let (other_action, other_marker) = if marker == "CHERRY_PICK_HEAD" {
                        ("revert", "REVERT_HEAD")
                    } else {
                        ("cherry-pick", "CHERRY_PICK_HEAD")
                    };
                    // 标记必须严格匹配：请求的 kind 与磁盘上唯一的中断标记一致。
                    if self.marker_exists(other_marker) {
                        issues.push(
                            issue(
                                "gate_interruption_mismatch",
                                format!(
                                    "请求的是 {action} 中断，但检测到 {other_action} 中断标记（{other_marker}）"
                                ),
                            )
                            .with_arg("action", action)
                            .with_arg("other", other_action)
                            .with_arg("marker", other_marker),
                        );
                    } else if !self.marker_exists(marker) {
                        issues.push(
                            issue(
                                "gate_interruption_marker_absent",
                                format!("未检测到 {marker}，当前没有可{verb}的 {action} 操作"),
                            )
                            .with_arg("marker", marker)
                            .with_arg("action", action)
                            .with_arg("verb", verb_name),
                        );
                    }
                    for (name, label) in [
                        ("MERGE_HEAD", "merge"),
                        ("REBASE_HEAD", "rebase"),
                        ("rebase-merge", "rebase"),
                        ("rebase-apply", "rebase"),
                    ] {
                        if self.marker_exists(name) {
                            issues.push(
                                issue(
                                    "gate_interruption_unsupported",
                                    format!(
                                        "检测到 {label} 中断（{name}），本应用只接管单次 cherry-pick / revert"
                                    ),
                                )
                                .with_arg("label", label)
                                .with_arg("marker", name),
                            );
                        }
                    }
                    if self.marker_exists("sequencer") {
                        issues.push(issue(
                            "gate_sequenced_operation",
                            "检测到批量 cherry-pick / revert 序列（sequencer），请在终端继续或中止",
                        ));
                    }
                    if self.marker_exists("index.lock") {
                        issues.push(issue(
                            "gate_index_locked",
                            "index.lock 被占用，请等待其他 Git 进程结束后重试；本应用不会删除锁文件",
                        ));
                    }
                    if continuing && status.conflicted > 0 {
                        issues.push(
                            issue(
                                "gate_unresolved_conflicts",
                                format!(
                                    "还有 {} 个文件存在未解决冲突，请先解决冲突并 git add 后再继续",
                                    status.conflicted
                                ),
                            )
                            .with_arg("n", status.conflicted.to_string()),
                        );
                    }
                    if continuing {
                        summary = format!("将执行 git {action} --continue，完成当前 {action} 操作");
                        summary_key = "errors.gateSummaryContinue";
                        summary_args = args_map(&[("action", action)]);
                    } else {
                        summary = format!(
                            "将执行 git {action} --abort，回到操作开始前的状态；已手工解决的冲突内容会丢失"
                        );
                        summary_key = "errors.gateSummaryAbort";
                        summary_args = args_map(&[("action", action)]);
                    }
                }
                (summary, summary_key, summary_args)
            }
        };

        Ok(GateReportDto {
            ok: issues.is_empty(),
            issues,
            warnings,
            affected_paths,
            affected_total,
            summary,
            summary_key: Some(summary_key.to_owned()),
            summary_args,
            is_merge_commit,
            parents: parent_options,
        })
    }
}

fn dirty_parts(status: &StatusSummary) -> String {
    let mut parts = Vec::new();
    if status.tracked > 0 {
        parts.push(format!("{} 个已修改文件", status.tracked));
    }
    if status.staged > 0 {
        parts.push(format!("{} 个已暂存文件", status.staged));
    }
    if status.untracked > 0 {
        parts.push(format!("{} 个未跟踪文件", status.untracked));
    }
    parts.join("、")
}

fn dirty_issue(status: &StatusSummary) -> GateIssueDto {
    let parts = dirty_parts(status);
    issue(
        "gate_worktree_dirty",
        format!("工作区不干净（{parts}），请先提交或在终端处理"),
    )
    .with_arg("parts", parts)
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto::new(code, message)
}

fn short_oid(oid: &str) -> &str {
    oid.get(..8).unwrap_or(oid)
}

/// 插值参数表 → BTreeMap；仅用于带参数的 i18n 模板。
fn args_map(pairs: &[(&str, &str)]) -> Option<BTreeMap<String, String>> {
    Some(
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect(),
    )
}
