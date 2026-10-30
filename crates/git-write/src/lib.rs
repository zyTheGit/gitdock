//! GitWriteModule：有限写操作的状态机实现。
//!
//! 约束：只接受白名单操作；一切命令以参数数组启动、不经 shell；每次执行前运行
//! Gate；状态路径全部经 `git rev-parse --git-path` 取得；绝不自动 abort / quit。
//! 结果以退出码与执行后重新探测到的操作态判定，不解析输出文本猜测冲突。

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};

use git_core::{
    git_command, language_for, BranchDescriptionDto, ErrorCode, FileDiffDto, FileStatus,
    GateIssueDto, GateReportDto, HeadDto, InterruptionDto, InterruptionKind, Result,
    StagingFileDto, StagingStatusDto, UserVisibleError, WarningDto, WorkspaceStatusDto, WriteKind,
    WriteOutcomeDto, WriteRequest, WriteStatus,
};
use parking_lot::Mutex;

/// 单次批量暂存的文件上限；足够覆盖常规操作，同时限制路径列表与命令耗时。
const MAX_STAGING_PATHS: usize = 1000;
const MAX_STAGING_DIFF_BYTES: u64 = 2 * 1024 * 1024;
const MAX_STAGING_PATCH_LINES: usize = 5000;
/// Gate 报告中受影响文件清单的上限；超出部分由 `affected_total` 说明。
const MAX_AFFECTED_PATHS: usize = 50;

const MARKERS: &[(&str, InterruptionKind)] = &[
    ("MERGE_HEAD", InterruptionKind::Merge),
    ("CHERRY_PICK_HEAD", InterruptionKind::CherryPick),
    ("REVERT_HEAD", InterruptionKind::Revert),
    ("REBASE_HEAD", InterruptionKind::Rebase),
    ("rebase-merge", InterruptionKind::Rebase),
    ("rebase-apply", InterruptionKind::Rebase),
    ("sequencer", InterruptionKind::Sequencer),
    ("index.lock", InterruptionKind::IndexLock),
];

pub struct GitWriteModule {
    root: PathBuf,
    /// 全局互斥：同一仓库同一时刻最多一个写操作。
    write_lock: Mutex<()>,
}

struct StatusSummary {
    staged: u32,
    tracked: u32,
    untracked: u32,
    conflicted: u32,
    conflicted_files: Vec<String>,
}

struct StatusEntry {
    path: String,
    old_path: Option<String>,
    index_code: char,
    worktree_code: char,
    untracked: bool,
    conflicted: bool,
}

struct StatusDetail {
    summary: StatusSummary,
    entries: Vec<StatusEntry>,
}

struct Numstat {
    additions: u32,
    deletions: u32,
    binary: bool,
}

struct CommandSpec {
    args: Vec<String>,
    stdin: Option<Vec<u8>>,
    description_write: bool,
}

impl GitWriteModule {
    pub fn new(root: &Path) -> Result<Self> {
        let root = std::fs::canonicalize(root).map_err(|e| {
            UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不存在或不可访问")
                .with_detail(e.to_string())
        })?;
        Ok(Self {
            root,
            write_lock: Mutex::new(()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 写前 Gate。`issues` 非空即拒绝执行；summary 用于确认框。
    pub fn validate(&self, request: &WriteRequest) -> Result<GateReportDto> {
        let mut issues = Vec::new();
        let mut warnings = Vec::new();
        let mut affected_paths = Vec::new();
        let mut affected_total = 0usize;
        let mut is_merge_commit = false;

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
            });
        }

        let interruption = self.inspect_interruption()?;
        if interruption.is_active() {
            issues.push(issue(
                "interrupted",
                format!(
                    "存在未完成的 Git 操作：{}；{}",
                    kind_names(&interruption.kinds),
                    interruption.terminal_hint
                ),
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
                let parents = self.commit_parents(oid.as_str())?;
                is_merge_commit = parents.len() > 1;
                if is_merge_commit {
                    issues.push(issue(
                        "merge_commit",
                        "merge commit 不支持 cherry-pick / revert，请在终端使用 -m 指定父提交",
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
                format!(
                    "将 {} {} 到当前分支 {}",
                    if request.kind == WriteKind::CherryPick {
                        "cherry-pick"
                    } else {
                        "revert"
                    },
                    short_oid(oid.as_str()),
                    head.branch.as_deref().unwrap_or("（未知分支）")
                )
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
        };

        Ok(GateReportDto {
            ok: issues.is_empty(),
            issues,
            warnings,
            affected_paths,
            affected_total,
            summary,
            is_merge_commit,
        })
    }

    /// 执行白名单操作。任何非零退出后都重新探测操作态，再判定结果。
    pub fn execute(&self, request: &WriteRequest) -> Result<WriteOutcomeDto> {
        let _guard = self.write_lock.try_lock().ok_or_else(|| {
            UserVisibleError::new(ErrorCode::Internal, "已有写操作正在进行，请稍后再试")
        })?;

        let gate = self.validate(request)?;
        if !gate.ok {
            return Ok(WriteOutcomeDto {
                status: WriteStatus::Rejected,
                message: gate
                    .issues
                    .iter()
                    .map(|issue| issue.message.as_str())
                    .collect::<Vec<_>>()
                    .join("；"),
                exit_code: None,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: None,
                generation: None,
                head_oid: None,
            });
        }

        let spec = self.command_for(request)?;
        let mut command = git_command();
        command
            .current_dir(&self.root)
            .args(&spec.args)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_TERMINAL_PROMPT", "0");
        let output = if let Some(stdin) = spec.stdin {
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command.spawn().map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法启动 git 命令")
                    .with_detail(e.to_string())
            })?;
            let write_result = child
                .stdin
                .take()
                .map(|mut pipe| pipe.write_all(&stdin))
                .unwrap_or(Ok(()));
            if let Err(err) = write_result {
                let _ = child.kill();
                let _ = child.wait();
                return Err(UserVisibleError::new(
                    ErrorCode::GitCommandFailed,
                    "无法向 git 写入路径列表",
                )
                .with_detail(err.to_string()));
            }
            child.wait_with_output().map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "等待 git 命令结束失败")
                    .with_detail(e.to_string())
            })?
        } else {
            command.output().map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法启动 git 命令")
                    .with_detail(e.to_string())
            })?
        };
        let exit_code = output.status.code();
        let stderr = text(&output.stderr);
        let head_oid = self.head_oid().ok();

        if spec.description_write && exit_code == Some(5) {
            // --unset-all 在键不存在时返回 5；结果等价于空描述。
            return Ok(WriteOutcomeDto {
                status: WriteStatus::Succeeded,
                message: description_message(request, true),
                exit_code,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        if exit_code == Some(0) {
            return Ok(WriteOutcomeDto {
                status: WriteStatus::Succeeded,
                message: match request.kind {
                    WriteKind::CherryPick => "Cherry-pick 成功，图谱已刷新".into(),
                    WriteKind::Revert => "Revert 成功，图谱已刷新".into(),
                    WriteKind::SwitchBranch => {
                        let branch = request.branch.as_deref().unwrap_or_default();
                        if gate.affected_total > 0 {
                            format!(
                                "已切换到分支 {branch}，{} 个文件的工作区改动已保留",
                                gate.affected_total
                            )
                        } else {
                            format!("已切换到分支 {branch}")
                        }
                    }
                    WriteKind::SetBranchDescription => description_message(request, false),
                    WriteKind::StageFiles => format!(
                        "已暂存 {} 个文件",
                        request.paths.as_deref().unwrap_or(&[]).len()
                    ),
                    WriteKind::UnstageFiles => format!(
                        "已取消暂存 {} 个文件",
                        request.paths.as_deref().unwrap_or(&[]).len()
                    ),
                },
                exit_code,
                stderr: None,
                conflict_files: Vec::new(),
                interruption: Some(self.inspect_interruption()?),
                generation: None,
                head_oid,
            });
        }

        // 非零退出：以「操作后是否留下本次操作对应的标记」判定冲突，而不是猜 stderr。
        if matches!(request.kind, WriteKind::CherryPick | WriteKind::Revert) {
            let marker = if request.kind == WriteKind::CherryPick {
                "CHERRY_PICK_HEAD"
            } else {
                "REVERT_HEAD"
            };
            if self.marker_exists(marker) {
                let status = self.status_summary()?;
                if status.conflicted > 0 {
                    let interruption = self.inspect_interruption()?;
                    return Ok(WriteOutcomeDto {
                        status: WriteStatus::Conflicted,
                        message: format!(
                            "{} 产生冲突，请在终端处理；本应用不会自动 abort / quit",
                            if request.kind == WriteKind::CherryPick {
                                "Cherry-pick"
                            } else {
                                "Revert"
                            }
                        ),
                        exit_code,
                        stderr: Some(stderr),
                        conflict_files: status.conflicted_files,
                        interruption: Some(interruption),
                        generation: None,
                        head_oid,
                    });
                }
                if status.staged == 0 && status.tracked == 0 && status.untracked == 0 {
                    // 空 pick：状态由本应用发起，且工作区/索引干净，安全清理。
                    let skip = if request.kind == WriteKind::CherryPick {
                        "cherry-pick"
                    } else {
                        "revert"
                    };
                    let _ = self.run(&[skip, "--skip"]);
                    return Ok(WriteOutcomeDto {
                        status: WriteStatus::EmptyPick,
                        message: "无变更：该提交的内容已包含在当前分支中，已清理操作状态".into(),
                        exit_code,
                        stderr: Some(stderr),
                        conflict_files: Vec::new(),
                        interruption: Some(self.inspect_interruption()?),
                        generation: None,
                        head_oid,
                    });
                }
            }
        }

        Ok(WriteOutcomeDto {
            status: WriteStatus::Failed,
            message: if request.kind == WriteKind::SwitchBranch {
                "切换被 Git 拒绝，未执行 stash / reset / clean；请根据诊断信息处理（提交、暂存或在终端处理）后重试"
                    .into()
            } else {
                "Git 拒绝了本次操作".into()
            },
            exit_code,
            stderr: Some(stderr),
            conflict_files: Vec::new(),
            interruption: Some(self.inspect_interruption()?),
            generation: None,
            head_oid,
        })
    }

    /// 通过 `git rev-parse --git-path` 探测中断态；不拼接 `.git/`。
    pub fn inspect_interruption(&self) -> Result<InterruptionDto> {
        let mut kinds = Vec::new();
        for (name, kind) in MARKERS {
            if self.marker_exists(name) && !kinds.contains(kind) {
                kinds.push(*kind);
            }
        }
        if kinds.is_empty() {
            return Ok(InterruptionDto::none());
        }
        let status = self.status_summary().unwrap_or(StatusSummary {
            staged: 0,
            tracked: 0,
            untracked: 0,
            conflicted: 0,
            conflicted_files: Vec::new(),
        });
        Ok(InterruptionDto {
            message: format!("检测到未完成的 Git 操作：{}", kind_names(&kinds)),
            terminal_hint: terminal_hint(&kinds),
            files: status.conflicted_files,
            kinds,
        })
    }

    pub fn workspace_status(&self) -> Result<WorkspaceStatusDto> {
        let head = self.head_kind()?;
        let bare = self.is_bare()?;
        let status = if bare {
            StatusSummary {
                staged: 0,
                tracked: 0,
                untracked: 0,
                conflicted: 0,
                conflicted_files: Vec::new(),
            }
        } else {
            self.status_summary()?
        };
        Ok(WorkspaceStatusDto {
            dirty: status.staged > 0
                || status.tracked > 0
                || status.untracked > 0
                || status.conflicted > 0,
            staged: status.staged,
            tracked: status.tracked,
            untracked: status.untracked,
            conflicted: status.conflicted,
            is_bare: bare,
            detached: head.detached,
        })
    }

    /// 按 HEAD → Index → Worktree 读取暂存区：staged 与 unstaged 分开，未跟踪只在 unstaged，
    /// 冲突文件单列；generation 由 command 层注入。
    pub fn staging_status(&self) -> Result<StagingStatusDto> {
        let head = self.head_kind()?;
        let is_bare = self.is_bare()?;
        let mut head_dto = head.dto();
        head_dto.oid = self.head_oid().ok();
        if is_bare {
            return Ok(StagingStatusDto {
                generation: 0,
                head: head_dto,
                unborn: head.unborn,
                detached: head.detached,
                is_bare: true,
                staged: Vec::new(),
                unstaged: Vec::new(),
                conflicted_files: Vec::new(),
                warnings: vec![WarningDto {
                    code: "bare_repository".into(),
                    message: "bare 仓库没有工作区，暂存区为空".into(),
                }],
            });
        }

        let detail = self.status_detail()?;
        let staged_stats = self.numstat(true)?;
        let unstaged_stats = self.numstat(false)?;
        let mut staged = Vec::new();
        let mut unstaged = Vec::new();
        for entry in &detail.entries {
            if entry.conflicted {
                continue;
            }
            if entry.untracked {
                unstaged.push(make_staging_file(entry, false, &unstaged_stats));
                continue;
            }
            if entry.index_code != '.' {
                staged.push(make_staging_file(entry, true, &staged_stats));
            }
            if entry.worktree_code != '.' {
                unstaged.push(make_staging_file(entry, false, &unstaged_stats));
            }
        }
        let mut warnings = Vec::new();
        if detail.summary.conflicted > 0 {
            warnings.push(WarningDto {
                code: "conflicted_index".into(),
                message: format!(
                    "存在 {} 个未解决冲突文件，暂存区操作已禁用；请在终端解决后继续",
                    detail.summary.conflicted
                ),
            });
        }
        Ok(StagingStatusDto {
            generation: 0,
            head: head_dto,
            unborn: head.unborn,
            detached: head.detached,
            is_bare: false,
            staged,
            unstaged,
            conflicted_files: detail.summary.conflicted_files,
            warnings,
        })
    }

    /// 单文件 diff：staged 取索引对 HEAD，unstaged 取工作区对索引；
    /// 未跟踪文件用 `git diff --no-index` 生成新增 diff。
    pub fn staging_file_diff(&self, path: &str, staged: bool) -> Result<FileDiffDto> {
        if !safe_rel_path(path) {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("路径无效：{path}"),
            ));
        }
        let detail = self.status_detail()?;
        let entry = detail
            .entries
            .iter()
            .find(|entry| entry.path == path)
            .ok_or_else(|| {
                UserVisibleError::new(
                    ErrorCode::FileNotFound,
                    format!("暂存区中没有文件 {path}，请刷新后重试"),
                )
            })?;
        if entry.conflicted {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "冲突文件需要在终端解决，应用内不提供冲突 diff",
            ));
        }
        if entry.untracked {
            if staged {
                return Err(UserVisibleError::new(
                    ErrorCode::InvalidArgument,
                    "未跟踪文件尚未暂存",
                ));
            }
            return self.untracked_diff(entry);
        }
        if staged && entry.index_code == '.' {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("{path} 没有已暂存改动"),
            ));
        }
        if !staged && entry.worktree_code == '.' {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("{path} 没有未暂存改动"),
            ));
        }
        self.tracked_diff(entry, staged)
    }

    pub fn read_branch_description(&self, branch: &str) -> Result<BranchDescriptionDto> {
        if !self.local_branch_exists(branch)? {
            return Err(UserVisibleError::new(
                ErrorCode::BranchNotFound,
                format!("本地分支 {branch} 不存在"),
            ));
        }
        let key = format!("branch.{branch}.description");
        let output = self.run(&["config", "--local", "--get", &key])?;
        let description = if output.status.success() {
            text(&output.stdout)
                .trim_end_matches(['\r', '\n'])
                .to_owned()
        } else {
            String::new()
        };
        Ok(BranchDescriptionDto {
            branch: branch.to_owned(),
            description,
            shared_across_worktrees: self.is_linked_worktree()?,
        })
    }

    fn command_for(&self, request: &WriteRequest) -> Result<CommandSpec> {
        let mut spec = CommandSpec {
            args: Vec::new(),
            stdin: None,
            description_write: false,
        };
        spec.args = match request.kind {
            WriteKind::CherryPick => vec![
                "cherry-pick".into(),
                request
                    .oid
                    .as_ref()
                    .ok_or_else(|| {
                        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
                    })?
                    .to_string(),
            ],
            WriteKind::Revert => vec![
                "revert".into(),
                "--no-edit".into(),
                request
                    .oid
                    .as_ref()
                    .ok_or_else(|| {
                        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
                    })?
                    .to_string(),
            ],
            WriteKind::SwitchBranch => vec![
                "switch".into(),
                "--no-guess".into(),
                request.branch.clone().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                })?,
            ],
            WriteKind::SetBranchDescription => {
                let branch = request.branch.clone().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                })?;
                let key = format!("branch.{branch}.description");
                let value = request.description.clone().unwrap_or_default();
                if value.trim().is_empty() {
                    vec!["config".into(), "--local".into(), "--unset-all".into(), key]
                } else {
                    vec!["config".into(), "--local".into(), key, value]
                }
            }
            WriteKind::StageFiles => {
                spec.stdin = Some(pathspec_stdin(&request.paths, None));
                vec![
                    "add".into(),
                    "-A".into(),
                    "--pathspec-from-file=-".into(),
                    "--pathspec-file-nul".into(),
                ]
            }
            WriteKind::UnstageFiles => {
                // 重命名条目的旧路径也在索引中，必须一起取消暂存；由状态条目补全。
                let detail = self.status_detail()?;
                spec.stdin = Some(pathspec_stdin(&request.paths, Some(&detail.entries)));
                if self.head_commit_exists()? {
                    vec![
                        "restore".into(),
                        "--staged".into(),
                        "--pathspec-from-file=-".into(),
                        "--pathspec-file-nul".into(),
                    ]
                } else {
                    // unborn HEAD 下 `git restore --staged` 无法解析 HEAD，改用 git rm --cached。
                    vec![
                        "rm".into(),
                        "--cached".into(),
                        "--pathspec-from-file=-".into(),
                        "--pathspec-file-nul".into(),
                    ]
                }
            }
        };
        spec.description_write = request.kind == WriteKind::SetBranchDescription;
        Ok(spec)
    }

    fn status_detail(&self) -> Result<StatusDetail> {
        let output = self.run_readonly(&[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=normal",
            "--branch",
        ])?;
        if !output.status.success() {
            return Err(
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法读取工作区状态")
                    .with_detail(text(&output.stderr)),
            );
        }
        Ok(parse_status_detail(&output.stdout))
    }

    fn status_summary(&self) -> Result<StatusSummary> {
        Ok(self.status_detail()?.summary)
    }

    fn numstat(&self, staged: bool) -> Result<HashMap<String, Numstat>> {
        let mut args = vec!["diff", "--numstat", "-z", "-M"];
        if staged {
            args.push("--cached");
        }
        let output = self.run_readonly(&args)?;
        if !output.status.success() {
            return Err(
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法读取变更统计")
                    .with_detail(text(&output.stderr)),
            );
        }
        Ok(parse_numstat_z(&output.stdout))
    }

    fn untracked_diff(&self, entry: &StatusEntry) -> Result<FileDiffDto> {
        let full = self.root.join(&entry.path);
        let meta = std::fs::symlink_metadata(&full).map_err(|err| {
            UserVisibleError::new(ErrorCode::Io, format!("无法读取 {}", entry.path))
                .with_detail(err.to_string())
        })?;
        if meta.file_type().is_symlink() {
            return Ok(note_diff(
                &entry.path,
                FileStatus::Added,
                "未跟踪的符号链接，不展开链接目标内容",
            ));
        }
        if !meta.is_file() {
            return Ok(note_diff(
                &entry.path,
                FileStatus::Added,
                "该路径不是普通文件，无法显示 diff",
            ));
        }
        if meta.len() > MAX_STAGING_DIFF_BYTES {
            let mut dto = note_diff(
                &entry.path,
                FileStatus::Added,
                "文件超过 2MB，未生成文本差异",
            );
            dto.too_large = true;
            return Ok(dto);
        }
        let output = self.run_readonly(&[
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--unified=3",
            "--",
            "/dev/null",
            &entry.path,
        ])?;
        // --no-index 在存在差异时返回 1，这不是失败。
        if !matches!(output.status.code(), Some(0) | Some(1)) {
            return Err(UserVisibleError::new(
                ErrorCode::GitCommandFailed,
                "无法生成未跟踪文件 diff",
            )
            .with_detail(text(&output.stderr)));
        }
        Ok(build_diff(
            &entry.path,
            None,
            FileStatus::Added,
            &output.stdout,
        ))
    }

    fn tracked_diff(&self, entry: &StatusEntry, staged: bool) -> Result<FileDiffDto> {
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--unified=3", "-M"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(&entry.path);
        // 已暂存的重命名只有同时传入旧路径才会显示为 rename，否则会被当成新增。
        if staged {
            if let Some(old_path) = entry.old_path.as_deref() {
                if old_path != entry.path {
                    args.push(old_path);
                }
            }
        }
        let output = self.run_readonly(&args)?;
        if !output.status.success() {
            return Err(
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法生成文件 diff")
                    .with_detail(text(&output.stderr)),
            );
        }
        let status = file_status_from_code(if staged {
            entry.index_code
        } else {
            entry.worktree_code
        });
        let old_path = if staged { entry.old_path.clone() } else { None };
        Ok(build_diff(&entry.path, old_path, status, &output.stdout))
    }

    fn marker_exists(&self, name: &str) -> bool {
        self.git_path(name)
            .and_then(|path| std::fs::symlink_metadata(path).ok())
            .is_some()
    }

    fn git_path(&self, name: &str) -> Option<PathBuf> {
        let output = self.run(&["rev-parse", "--git-path", name]).ok()?;
        if !output.status.success() {
            return None;
        }
        let raw = text(&output.stdout).trim().to_owned();
        if raw.is_empty() {
            return None;
        }
        let path = PathBuf::from(raw);
        Some(if path.is_absolute() {
            path
        } else {
            self.root.join(path)
        })
    }

    fn head_kind(&self) -> Result<HeadInfo> {
        let branch = self.run(&["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        let branch = if branch.status.success() {
            Some(text(&branch.stdout).trim().to_owned())
        } else {
            None
        };
        Ok(HeadInfo {
            unborn: branch.is_some() && !self.head_commit_exists()?,
            detached: branch.is_none(),
            branch,
        })
    }

    fn head_commit_exists(&self) -> Result<bool> {
        Ok(self
            .run(&["rev-parse", "--verify", "--quiet", "HEAD"])?
            .status
            .success())
    }

    fn head_oid(&self) -> Result<git_core::Oid> {
        let output = self.run(&["rev-parse", "HEAD"])?;
        let raw = text(&output.stdout).trim().to_owned();
        git_core::Oid::new(&raw).map_err(|e| {
            UserVisibleError::new(ErrorCode::GitCommandFailed, "无法读取 HEAD")
                .with_detail(e.to_string())
        })
    }

    fn is_bare(&self) -> Result<bool> {
        let output = self.run(&["rev-parse", "--is-bare-repository"])?;
        Ok(text(&output.stdout).trim() == "true")
    }

    fn is_linked_worktree(&self) -> Result<bool> {
        let common = self.run(&["rev-parse", "--git-common-dir"])?;
        let own = self.run(&["rev-parse", "--absolute-git-dir"])?;
        if !common.status.success() || !own.status.success() {
            return Ok(false);
        }
        let common = self.root.join(text(&common.stdout).trim());
        let own = PathBuf::from(text(&own.stdout).trim());
        // Windows 下 `--git-common-dir` 可能返回相对或正斜杠形式，必须归一化后比较。
        let common = std::fs::canonicalize(&common).unwrap_or(common);
        let own = std::fs::canonicalize(&own).unwrap_or(own);
        Ok(common != own)
    }

    fn local_branch_exists(&self, branch: &str) -> Result<bool> {
        if branch.is_empty() || branch.starts_with('-') {
            return Ok(false);
        }
        let reference = format!("refs/heads/{branch}");
        let output = self.run(&["show-ref", "--verify", "--quiet", &reference])?;
        Ok(output.status.success())
    }

    /// 返回占用目标分支的其他 worktree 路径（当前 worktree 的同名分支已单独判断）。
    fn worktree_owner(&self, branch: &str, current: Option<&str>) -> Result<Option<String>> {
        if current == Some(branch) {
            return Ok(None);
        }
        let output = self.run(&["worktree", "list", "--porcelain"])?;
        if !output.status.success() {
            return Ok(None);
        }
        let target = format!("refs/heads/{branch}");
        let mut path: Option<String> = None;
        for line in text(&output.stdout).lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                path = Some(rest.to_owned());
            } else if let Some(rest) = line.strip_prefix("branch ") {
                if rest.trim() == target {
                    return Ok(path.clone());
                }
            }
        }
        Ok(None)
    }

    fn commit_parents(&self, oid: &str) -> Result<Vec<String>> {
        let output = self.run(&["rev-list", "--no-walk", "--parents", oid, "--"])?;
        if !output.status.success() {
            return Err(
                UserVisibleError::new(ErrorCode::InvalidArgument, "提交不存在或无法读取")
                    .with_detail(text(&output.stderr)),
            );
        }
        let line = text(&output.stdout);
        let mut parts = line.split_whitespace();
        let _self_oid = parts.next();
        Ok(parts.map(|value| value.to_owned()).collect())
    }

    fn run(&self, args: &[&str]) -> Result<Output> {
        git_command()
            .current_dir(&self.root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| {
                UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                    .with_detail(e.to_string())
            })
    }

    /// `status` 默认会拿可选索引锁并创建/删除 index.lock，本应用监听到 .git 变化后
    /// 又触发刷新，形成「刷新 → status → 监听 → 刷新」的自激循环并冲掉当前页；
    /// 关掉可选锁后 status 不再写锁文件，工作区状态结果不变。
    fn run_readonly(&self, args: &[&str]) -> Result<Output> {
        git_command()
            .current_dir(&self.root)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| {
                UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                    .with_detail(e.to_string())
            })
    }
}

struct HeadInfo {
    branch: Option<String>,
    detached: bool,
    unborn: bool,
}

impl HeadInfo {
    fn dto(&self) -> HeadDto {
        HeadDto {
            kind: if self.unborn {
                git_core::HeadKind::Unborn
            } else if self.detached {
                git_core::HeadKind::Detached
            } else {
                git_core::HeadKind::Branch
            },
            branch: self.branch.clone(),
            oid: None,
        }
    }
}

fn parse_status_detail(bytes: &[u8]) -> StatusDetail {
    let mut summary = StatusSummary {
        staged: 0,
        tracked: 0,
        untracked: 0,
        conflicted: 0,
        conflicted_files: Vec::new(),
    };
    let mut entries = Vec::new();
    let tokens: Vec<String> = bytes
        .split(|byte| *byte == 0)
        .filter(|token| !token.is_empty())
        .map(|token| String::from_utf8_lossy(token).into_owned())
        .collect();
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        index += 1;
        if token.starts_with('#') || token.starts_with('!') {
            continue;
        }
        if let Some(path) = token.strip_prefix("? ") {
            summary.untracked += 1;
            entries.push(StatusEntry {
                path: path.to_owned(),
                old_path: None,
                index_code: '?',
                worktree_code: '?',
                untracked: true,
                conflicted: false,
            });
        } else if token.starts_with("1 ") {
            let fields: Vec<&str> = token.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let (x, y) = xy_codes(fields[1]);
                if x != '.' {
                    summary.staged += 1;
                }
                if y != '.' {
                    summary.tracked += 1;
                }
                entries.push(StatusEntry {
                    path: fields[8].to_owned(),
                    old_path: None,
                    index_code: x,
                    worktree_code: y,
                    untracked: false,
                    conflicted: false,
                });
            }
        } else if token.starts_with("2 ") {
            let fields: Vec<&str> = token.splitn(10, ' ').collect();
            if fields.len() == 10 {
                let (x, y) = xy_codes(fields[1]);
                if x != '.' {
                    summary.staged += 1;
                }
                if y != '.' {
                    summary.tracked += 1;
                }
                // -z 模式下重命名条目的原路径是下一个 NUL 分隔字段。
                let old_path = tokens.get(index).cloned();
                index += 1;
                entries.push(StatusEntry {
                    path: fields[9].to_owned(),
                    old_path,
                    index_code: x,
                    worktree_code: y,
                    untracked: false,
                    conflicted: false,
                });
            } else {
                index += 1;
            }
        } else if token.starts_with("u ") {
            let fields: Vec<&str> = token.splitn(11, ' ').collect();
            summary.conflicted += 1;
            let path = fields
                .get(10)
                .map(|path| (*path).to_owned())
                .unwrap_or_default();
            if !path.is_empty() {
                summary.conflicted_files.push(path.clone());
            }
            if fields.len() == 11 {
                entries.push(StatusEntry {
                    path,
                    old_path: None,
                    index_code: 'U',
                    worktree_code: 'U',
                    untracked: false,
                    conflicted: true,
                });
            }
        }
    }
    StatusDetail { summary, entries }
}

fn xy_codes(xy: &str) -> (char, char) {
    let mut chars = xy.chars();
    (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'))
}

fn parse_numstat_z(bytes: &[u8]) -> HashMap<String, Numstat> {
    let tokens: Vec<String> = bytes
        .split(|byte| *byte == 0)
        .filter(|token| !token.is_empty())
        .map(|token| String::from_utf8_lossy(token).into_owned())
        .collect();
    let mut stats = HashMap::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        index += 1;
        let mut parts = token.splitn(3, '\t');
        let additions = parts.next().unwrap_or("");
        let deletions = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");
        let path = if path.is_empty() {
            // 重命名/复制：路径字段为空，随后两个 NUL 字段为旧路径与新路径。
            index += 2;
            tokens.get(index - 1).cloned().unwrap_or_default()
        } else {
            path.to_owned()
        };
        if path.is_empty() {
            continue;
        }
        stats.insert(
            path,
            Numstat {
                additions: additions.parse().unwrap_or(0),
                deletions: deletions.parse().unwrap_or(0),
                binary: additions == "-" || deletions == "-",
            },
        );
    }
    stats
}

fn make_staging_file(
    entry: &StatusEntry,
    staged: bool,
    stats: &HashMap<String, Numstat>,
) -> StagingFileDto {
    let code = if entry.untracked {
        '?'
    } else if staged {
        entry.index_code
    } else {
        entry.worktree_code
    };
    let stat = stats.get(&entry.path);
    StagingFileDto {
        path: entry.path.clone(),
        old_path: if staged { entry.old_path.clone() } else { None },
        status: file_status_from_code(code),
        index_code: (!entry.untracked).then(|| entry.index_code.to_string()),
        worktree_code: (!entry.untracked).then(|| entry.worktree_code.to_string()),
        additions: stat.map(|value| value.additions).unwrap_or(0),
        deletions: stat.map(|value| value.deletions).unwrap_or(0),
        binary: stat.map(|value| value.binary).unwrap_or(false),
        gitlink: false,
        untracked: entry.untracked,
    }
}

fn file_status_from_code(code: char) -> FileStatus {
    match code {
        'A' | '?' => FileStatus::Added,
        'D' => FileStatus::Deleted,
        'R' => FileStatus::Renamed,
        'C' => FileStatus::Copied,
        'T' => FileStatus::TypeChanged,
        _ => FileStatus::Modified,
    }
}

fn build_diff(
    path: &str,
    old_path: Option<String>,
    status: FileStatus,
    bytes: &[u8],
) -> FileDiffDto {
    let encoding_fallback = std::str::from_utf8(bytes).is_err();
    let patch_text = text(bytes);
    let binary = patch_text.contains("Binary files") || patch_text.contains("GIT binary patch");
    let gitlink = patch_text.contains("Subproject commit");
    let (additions, deletions) = if binary || gitlink {
        (0, 0)
    } else {
        patch_stats(&patch_text)
    };
    let mut dto = FileDiffDto {
        generation: 0,
        path: path.to_owned(),
        old_path,
        status,
        patch: None,
        binary,
        too_large: false,
        truncated: false,
        encoding_fallback,
        gitlink,
        gitlink_old: None,
        gitlink_new: None,
        additions,
        deletions,
        language: language_for(path),
        note: None,
    };
    if binary {
        dto.note = Some("二进制文件，无法显示文本差异".into());
        return dto;
    }
    if gitlink {
        dto.note = Some("子模块（gitlink）变更，请在终端查看".into());
        return dto;
    }
    if patch_text.trim().is_empty() {
        dto.note = Some("没有可显示的文本差异".into());
        return dto;
    }
    let line_count = patch_text.lines().count();
    if line_count > MAX_STAGING_PATCH_LINES {
        let truncated = patch_text
            .lines()
            .take(MAX_STAGING_PATCH_LINES)
            .collect::<Vec<_>>()
            .join("\n");
        dto.patch = Some(truncated);
        dto.truncated = true;
        dto.note = Some(format!(
            "差异超过 {MAX_STAGING_PATCH_LINES} 行，仅显示前 {MAX_STAGING_PATCH_LINES} 行"
        ));
    } else {
        dto.patch = Some(patch_text);
    }
    if encoding_fallback {
        dto.note = Some("文件不是合法 UTF-8，已按有损方式解码显示".into());
    }
    dto
}

fn note_diff(path: &str, status: FileStatus, note: &str) -> FileDiffDto {
    FileDiffDto {
        generation: 0,
        path: path.to_owned(),
        old_path: None,
        status,
        patch: None,
        binary: false,
        too_large: false,
        truncated: false,
        encoding_fallback: false,
        gitlink: false,
        gitlink_old: None,
        gitlink_new: None,
        additions: 0,
        deletions: 0,
        language: language_for(path),
        note: Some(note.to_owned()),
    }
}

fn patch_stats(patch: &str) -> (u32, u32) {
    let mut additions = 0;
    let mut deletions = 0;
    for line in patch.lines() {
        if line.starts_with("+++ ") || line.starts_with("--- ") {
            continue;
        }
        if line.starts_with('+') {
            additions += 1;
        } else if line.starts_with('-') {
            deletions += 1;
        }
    }
    (additions, deletions)
}

fn pathspec_stdin(paths: &Option<Vec<String>>, entries: Option<&[StatusEntry]>) -> Vec<u8> {
    let mut stdin = Vec::new();
    let mut seen = HashSet::new();
    for path in paths.as_deref().unwrap_or(&[]) {
        if seen.insert(path.clone()) {
            stdin.extend_from_slice(path.as_bytes());
            stdin.push(0);
        }
        if let Some(entry) =
            entries.and_then(|entries| entries.iter().find(|entry| entry.path == *path))
        {
            if let Some(old_path) = entry.old_path.as_ref() {
                if old_path != path && seen.insert(old_path.clone()) {
                    stdin.extend_from_slice(old_path.as_bytes());
                    stdin.push(0);
                }
            }
        }
    }
    stdin
}

/// 只允许仓库内的相对路径；拒绝绝对路径、盘符、`..` 与 pathspec magic。
fn safe_rel_path(path: &str) -> bool {
    !path.is_empty()
        && path == path.trim()
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.starts_with(':')
        && !path.starts_with('-')
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn kind_names(kinds: &[InterruptionKind]) -> String {
    kinds
        .iter()
        .map(|kind| match kind {
            InterruptionKind::Merge => "merge 未完成",
            InterruptionKind::CherryPick => "cherry-pick 未完成",
            InterruptionKind::Revert => "revert 未完成",
            InterruptionKind::Rebase => "rebase 未完成",
            InterruptionKind::Sequencer => "sequencer 未完成",
            InterruptionKind::IndexLock => "index.lock 被占用",
        })
        .collect::<Vec<_>>()
        .join("、")
}

fn terminal_hint(kinds: &[InterruptionKind]) -> String {
    if kinds.contains(&InterruptionKind::IndexLock) {
        return "请确认没有其他 Git 进程后，在终端手动删除 index.lock；本应用不会删除任何锁文件"
            .into();
    }
    if kinds.contains(&InterruptionKind::CherryPick) {
        return "请在终端解决冲突后执行 git cherry-pick --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Revert) {
        return "请在终端解决冲突后执行 git revert --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Rebase) {
        return "请在终端执行 git rebase --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Merge) {
        return "请在终端执行 git merge --continue（或 git merge --abort）".into();
    }
    "请在终端完成或放弃当前操作".into()
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

fn description_message(request: &WriteRequest, removed: bool) -> String {
    let branch = request.branch.as_deref().unwrap_or_default();
    if removed
        || request
            .description
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        format!("已删除分支 {branch} 的本地描述")
    } else {
        format!("已更新分支 {branch} 的本地描述")
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
