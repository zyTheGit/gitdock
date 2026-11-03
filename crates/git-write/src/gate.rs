//! 写前 Gate：白名单操作的校验规则与 Gate 报告组装。

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
                "bare_repository",
                "bare 仓库不提供写操作，请使用工作区仓库或命令行",
            ));
            return Ok(GateReportDto {
                ok: false,
                issues,
                warnings,
                affected_paths,
                affected_total,
                summary: "bare 仓库不支持写操作".into(),
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
            issues.push(issue(
                "interrupted",
                format!(
                    "存在未完成的 Git 操作：{}；{}",
                    kind_names(&interruption.kinds),
                    interruption.terminal_hint
                ),
            ));
        }
        if !continues_interruption && request.interruption.is_some() {
            issues.push(issue(
                "interruption_not_applicable",
                "只有继续/中止操作可以指定中断类型",
            ));
        }

        let head = self.head_kind()?;
        let detail = self.status_detail()?;
        let status = &detail.summary;

        let summary = match request.kind {
            WriteKind::CherryPick | WriteKind::Revert => {
                let oid = request.oid.as_ref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
                })?;
                let parent_oids = self.commit_parents(oid.as_str())?;
                is_merge_commit = parent_oids.len() > 1;
                // 父提交列表按 `-m` 的 1 起始顺序给出，供前端选择基线父。
                parent_options = self.parent_options(&parent_oids)?;
                let parent_count = parent_oids.len() as u32;
                if is_merge_commit {
                    match request.mainline {
                        None => issues.push(issue(
                            "mainline_required",
                            format!(
                                "该提交是 merge commit（共 {parent_count} 个父提交），必须选择基线父提交（-m N）"
                            ),
                        )),
                        Some(n) if n == 0 || n > parent_count => issues.push(issue(
                            "mainline_invalid",
                            format!("基线父序号必须在 1..={parent_count} 之间"),
                        )),
                        Some(_) => {}
                    }
                } else if request.mainline.is_some() {
                    issues.push(issue(
                        "mainline_not_applicable",
                        "该提交不是 merge commit，不能指定基线父提交（-m）",
                    ));
                }
                if head.detached {
                    issues.push(issue("detached_head", "当前处于 detached HEAD，拒绝写操作"));
                }
                if head.unborn {
                    issues.push(issue("unborn_head", "当前分支尚无提交，拒绝写操作"));
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
                match request.mainline {
                    Some(n) if is_merge_commit && n >= 1 && n <= parent_count => format!(
                        "将 {action} {} 到当前分支 {branch}，以第 {n} 父提交为基线（{n}/{parent_count}）",
                        short_oid(oid.as_str())
                    ),
                    _ => format!(
                        "将 {action} {} 到当前分支 {branch}",
                        short_oid(oid.as_str())
                    ),
                }
            }
            WriteKind::SwitchBranch => {
                let branch = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                })?;
                if head.unborn {
                    issues.push(issue("unborn_head", "当前分支尚无提交，无法切换"));
                }
                if head.detached {
                    issues.push(issue(
                        "detached_head",
                        "detached HEAD 状态不支持切换，请先用命令行处理",
                    ));
                }
                if status.conflicted > 0 {
                    issues.push(issue(
                        "conflicted_index",
                        format!(
                            "索引中还有 {} 个未解决冲突文件，请先在终端解决后再切换分支",
                            status.conflicted
                        ),
                    ));
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
                    warnings.push(WarningDto {
                        code: "worktree_dirty".into(),
                        message: format!(
                            "工作区有 {affected_total} 个文件存在改动（{}）。不会自动 stash、reset 或 clean：改动会保留在工作区并可能带到目标分支；若目标分支会覆盖这些文件，Git 将拒绝切换并保持现状。",
                            dirty_parts(status)
                        ),
                    });
                }
                if !self.local_branch_exists(branch)? {
                    issues.push(issue(
                        "branch_not_found",
                        format!("本地分支 {branch} 不存在（不会猜测远程跟踪分支）"),
                    ));
                } else {
                    if head.branch.as_deref() == Some(branch) {
                        issues.push(issue(
                            "already_on_branch",
                            format!("已经在分支 {branch} 上"),
                        ));
                    }
                    if let Some(path) = self.worktree_owner(branch, head.branch.as_deref())? {
                        issues.push(issue(
                            "branch_checked_out",
                            format!("分支 {branch} 已被其他 worktree 占用：{path}"),
                        ));
                    }
                }
                if affected_total > 0 {
                    format!(
                        "将切换到本地分支 {branch}；{affected_total} 个有改动的文件会保留在工作区"
                    )
                } else {
                    format!("将切换到本地分支 {branch}")
                }
            }
            WriteKind::SetBranchDescription => {
                let branch = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                })?;
                if !self.local_branch_exists(branch)? {
                    issues.push(issue(
                        "branch_not_found",
                        format!("本地分支 {branch} 不存在"),
                    ));
                }
                if let Some(description) = request.description.as_deref() {
                    // 写前即校验值，前端在 Gate 阶段就能收到错误。
                    validate_branch_description(description)?;
                }
                format!("将更新分支 {branch} 的本地描述")
            }
            WriteKind::StageFiles | WriteKind::UnstageFiles => {
                let staging = request.kind == WriteKind::StageFiles;
                let paths = request.paths.as_deref().unwrap_or(&[]);
                if paths.is_empty() {
                    issues.push(issue("paths_required", "请选择要处理的文件"));
                }
                if paths.len() > MAX_STAGING_PATHS {
                    issues.push(issue(
                        "too_many_paths",
                        format!("一次最多处理 {MAX_STAGING_PATHS} 个文件"),
                    ));
                }
                for path in paths {
                    if !safe_rel_path(path) {
                        issues.push(issue("invalid_path", format!("路径无效：{path}")));
                        continue;
                    }
                    match detail.entries.iter().find(|entry| entry.path == *path) {
                        None => issues.push(issue(
                            "path_not_in_status",
                            format!("{path} 当前没有可处理的变更，请刷新后重试"),
                        )),
                        Some(entry) if entry.conflicted => issues.push(issue(
                            "conflicted_file",
                            format!("{path} 存在未解决冲突，请在终端处理"),
                        )),
                        Some(entry) => {
                            let has_worktree = entry.untracked || entry.worktree_code != '.';
                            let has_index = !entry.untracked && entry.index_code != '.';
                            if staging && !has_worktree {
                                issues.push(issue(
                                    "nothing_to_stage",
                                    format!("{path} 没有未暂存改动"),
                                ));
                            }
                            if !staging && !has_index {
                                issues.push(issue(
                                    "nothing_to_unstage",
                                    format!("{path} 没有已暂存改动"),
                                ));
                            }
                        }
                    }
                }
                if detail.summary.conflicted > 0 {
                    issues.push(issue(
                        "conflicted_index",
                        "存在未解决的冲突文件，请先在终端处理后再暂存",
                    ));
                }
                format!(
                    "将{} {} 个文件",
                    if staging { "暂存" } else { "取消暂存" },
                    paths.len()
                )
            }
            WriteKind::ContinueOperation | WriteKind::AbortOperation => {
                let continuing = request.kind == WriteKind::ContinueOperation;
                let verb = if continuing { "继续" } else { "中止" };
                let pick = match request.interruption {
                    Some(InterruptionKind::CherryPick) => Some(("cherry-pick", "CHERRY_PICK_HEAD")),
                    Some(InterruptionKind::Revert) => Some(("revert", "REVERT_HEAD")),
                    Some(_) => {
                        issues.push(issue(
                            "interruption_invalid",
                            "继续/中止只支持 cherry-pick 或 revert 中断",
                        ));
                        None
                    }
                    None => {
                        issues.push(issue(
                            "interruption_required",
                            format!("{verb}操作需要指定中断类型（cherry_pick 或 revert）"),
                        ));
                        None
                    }
                };
                let mut summary = format!("无法{verb}当前操作");
                if let Some((action, marker)) = pick {
                    let (other_action, other_marker) = if marker == "CHERRY_PICK_HEAD" {
                        ("revert", "REVERT_HEAD")
                    } else {
                        ("cherry-pick", "CHERRY_PICK_HEAD")
                    };
                    // 标记必须严格匹配：请求的 kind 与磁盘上唯一的中断标记一致。
                    if self.marker_exists(other_marker) {
                        issues.push(issue(
                            "interruption_mismatch",
                            format!(
                                "请求的是 {action} 中断，但检测到 {other_action} 中断标记（{other_marker}）"
                            ),
                        ));
                    } else if !self.marker_exists(marker) {
                        issues.push(issue(
                            "interruption_mismatch",
                            format!("未检测到 {marker}，当前没有可{verb}的 {action} 操作"),
                        ));
                    }
                    for (name, label) in [
                        ("MERGE_HEAD", "merge"),
                        ("REBASE_HEAD", "rebase"),
                        ("rebase-merge", "rebase"),
                        ("rebase-apply", "rebase"),
                    ] {
                        if self.marker_exists(name) {
                            issues.push(issue(
                                "interruption_mismatch",
                                format!(
                                    "检测到 {label} 中断（{name}），本应用只接管单次 cherry-pick / revert"
                                ),
                            ));
                        }
                    }
                    if self.marker_exists("sequencer") {
                        issues.push(issue(
                            "sequenced_operation",
                            "检测到批量 cherry-pick / revert 序列（sequencer），请在终端继续或中止",
                        ));
                    }
                    if self.marker_exists("index.lock") {
                        issues.push(issue(
                            "index_locked",
                            "index.lock 被占用，请等待其他 Git 进程结束后重试；本应用不会删除锁文件",
                        ));
                    }
                    if continuing && status.conflicted > 0 {
                        issues.push(issue(
                            "unresolved_conflicts",
                            format!(
                                "还有 {} 个文件存在未解决冲突，请先解决冲突并 git add 后再继续",
                                status.conflicted
                            ),
                        ));
                    }
                    summary = if continuing {
                        format!("将执行 git {action} --continue，完成当前 {action} 操作")
                    } else {
                        format!(
                            "将执行 git {action} --abort，回到操作开始前的状态；已手工解决的冲突内容会丢失"
                        )
                    };
                }
                summary
            }
        };

        Ok(GateReportDto {
            ok: issues.is_empty(),
            issues,
            warnings,
            affected_paths,
            affected_total,
            summary,
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
    issue(
        "worktree_dirty",
        format!(
            "工作区不干净（{}），请先提交或在终端处理",
            dirty_parts(status)
        ),
    )
}

fn issue(code: &str, message: impl Into<String>) -> GateIssueDto {
    GateIssueDto {
        code: code.into(),
        message: message.into(),
    }
}

fn short_oid(oid: &str) -> &str {
    oid.get(..8).unwrap_or(oid)
}
