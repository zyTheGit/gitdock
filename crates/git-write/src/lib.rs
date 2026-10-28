//! GitWriteModule：有限写操作的状态机实现。
//!
//! 约束：只接受白名单操作；一切命令以参数数组启动、不经 shell；每次执行前运行
//! Gate；状态路径全部经 `git rev-parse --git-path` 取得；绝不自动 abort / quit。
//! 结果以退出码与执行后重新探测到的操作态判定，不解析输出文本猜测冲突。

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use git_core::{
    BranchDescriptionDto, ErrorCode, GateIssueDto, GateReportDto, InterruptionDto,
    InterruptionKind, Result, UserVisibleError, WorkspaceStatusDto, WriteKind, WriteOutcomeDto,
    WriteRequest, WriteStatus,
};
use parking_lot::Mutex;

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
        let mut is_merge_commit = false;

        if self.is_bare()? {
            issues.push(issue(
                "bare_repository",
                "bare 仓库不提供写操作，请使用工作区仓库或命令行",
            ));
            return Ok(GateReportDto {
                ok: false,
                issues,
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
        let status = self.status_summary()?;

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
                    issues.push(dirty_issue(&status));
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
                if status.staged > 0 || status.tracked > 0 || status.untracked > 0 {
                    issues.push(dirty_issue(&status));
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
                format!("将切换到本地分支 {branch}")
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
        };

        Ok(GateReportDto {
            ok: issues.is_empty(),
            issues,
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

        let (args, description_write) = self.command_for(request)?;
        let mut command = Command::new("git");
        command
            .current_dir(&self.root)
            .args(&args)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .env("GIT_TERMINAL_PROMPT", "0");
        let output = command.output().map_err(|e| {
            UserVisibleError::new(ErrorCode::GitCommandFailed, "无法启动 git 命令")
                .with_detail(e.to_string())
        })?;
        let exit_code = output.status.code();
        let stderr = text(&output.stderr);
        let head_oid = self.head_oid().ok();

        if description_write && exit_code == Some(5) {
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
                    WriteKind::SwitchBranch => format!(
                        "已切换到分支 {}",
                        request.branch.as_deref().unwrap_or_default()
                    ),
                    WriteKind::SetBranchDescription => description_message(request, false),
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
            message: "Git 拒绝了本次操作".into(),
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

    fn command_for(&self, request: &WriteRequest) -> Result<(Vec<String>, bool)> {
        let args: Vec<String> = match request.kind {
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
        };
        Ok((args, request.kind == WriteKind::SetBranchDescription))
    }

    fn status_summary(&self) -> Result<StatusSummary> {
        let output = self.run(&[
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
        Ok(parse_status(&output.stdout))
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

    fn head_kind(&self) -> Result<HeadKind> {
        let branch = self.run(&["symbolic-ref", "--quiet", "--short", "HEAD"])?;
        let branch = if branch.status.success() {
            Some(text(&branch.stdout).trim().to_owned())
        } else {
            None
        };
        let has_commit = self
            .run(&["rev-parse", "--verify", "--quiet", "HEAD"])?
            .status
            .success();
        Ok(HeadKind {
            unborn: branch.is_some() && !has_commit,
            detached: branch.is_none(),
            branch,
        })
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
        Command::new("git")
            .current_dir(&self.root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| {
                UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                    .with_detail(e.to_string())
            })
    }
}

struct HeadKind {
    branch: Option<String>,
    detached: bool,
    unborn: bool,
}

fn parse_status(bytes: &[u8]) -> StatusSummary {
    let mut summary = StatusSummary {
        staged: 0,
        tracked: 0,
        untracked: 0,
        conflicted: 0,
        conflicted_files: Vec::new(),
    };
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
        if token.starts_with("1 ") {
            let fields: Vec<&str> = token.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let xy = fields[1].as_bytes();
                if xy.first().is_some_and(|x| *x != b'.') {
                    summary.staged += 1;
                }
                if xy.get(1).is_some_and(|y| *y != b'.') {
                    summary.tracked += 1;
                }
            }
        } else if token.starts_with("2 ") {
            let fields: Vec<&str> = token.splitn(10, ' ').collect();
            if fields.len() >= 10 {
                let xy = fields[1].as_bytes();
                if xy.first().is_some_and(|x| *x != b'.') {
                    summary.staged += 1;
                }
                if xy.get(1).is_some_and(|y| *y != b'.') {
                    summary.tracked += 1;
                }
            }
            // -z 模式下重命名条目的原路径是下一个 NUL 分隔字段。
            index += 1;
        } else if token.starts_with("u ") {
            let fields: Vec<&str> = token.splitn(11, ' ').collect();
            summary.conflicted += 1;
            if fields.len() == 11 {
                summary.conflicted_files.push(fields[10].to_owned());
            }
        } else if token.starts_with("? ") {
            summary.untracked += 1;
        }
    }
    summary
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

fn dirty_issue(status: &StatusSummary) -> GateIssueDto {
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
    issue(
        "worktree_dirty",
        format!("工作区不干净（{}），请先提交或在终端处理", parts.join("、")),
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
