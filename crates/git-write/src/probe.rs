//! 仓库状态探测：HEAD、引用、worktree 与只读 Git 查询。

use std::path::PathBuf;
use std::process::Output;

use git_core::{
    detect_kinds, interruption_dto, lossy_text as text, run_git_output, ErrorCode, InterruptionDto,
    ParentOptionDto, Result, UserVisibleError,
};

use crate::command::HeadInfo;
use crate::status::StatusSummary;
use crate::GitWriteModule;

impl GitWriteModule {
    /// 通过 `rev-parse --absolute-git-dir` 定位 per-worktree Git 目录后探测中断态；
    /// 标记表、归类与文案统一取自 git-core。
    pub fn inspect_interruption(&self) -> Result<InterruptionDto> {
        let Some(git_dir) = self.git_dir() else {
            // 与旧版逐标记探测失败时的行为一致：无法定位 Git 目录视为无中断。
            return Ok(InterruptionDto::none());
        };
        if detect_kinds(&git_dir).is_empty() {
            return Ok(InterruptionDto::none());
        }
        let files = self
            .status_summary()
            .unwrap_or(StatusSummary {
                staged: 0,
                tracked: 0,
                untracked: 0,
                conflicted: 0,
                conflicted_files: Vec::new(),
            })
            .conflicted_files;
        Ok(interruption_dto(&git_dir, files))
    }

    pub(crate) fn marker_exists(&self, name: &str) -> bool {
        self.git_dir()
            .and_then(|dir| std::fs::symlink_metadata(dir.join(name)).ok())
            .is_some()
    }

    /// per-worktree Git 目录；一次 `--absolute-git-dir` 解析后由标记探测共用，
    /// 与旧版逐标记 `rev-parse --git-path` 的路径语义等价。
    fn git_dir(&self) -> Option<PathBuf> {
        let output = self.run(&["rev-parse", "--absolute-git-dir"]).ok()?;
        if !output.status.success() {
            return None;
        }
        let raw = text(&output.stdout).trim().to_owned();
        if raw.is_empty() {
            return None;
        }
        Some(PathBuf::from(raw))
    }

    pub(crate) fn head_kind(&self) -> Result<HeadInfo> {
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

    pub(crate) fn head_commit_exists(&self) -> Result<bool> {
        Ok(self
            .run(&["rev-parse", "--verify", "--quiet", "HEAD"])?
            .status
            .success())
    }

    pub(crate) fn head_oid(&self) -> Result<git_core::Oid> {
        let output = self.run(&["rev-parse", "HEAD"])?;
        let raw = text(&output.stdout).trim().to_owned();
        git_core::Oid::new(&raw).map_err(|e| {
            UserVisibleError::new(ErrorCode::GitCommandFailed, "无法读取 HEAD")
                .with_key("errors.commandHeadUnreadable")
                .with_detail(e.to_string())
        })
    }

    /// HEAD 提交的（短 oid, 主题）；unborn 或读取失败返回 None，仅用于 amend Gate
    /// 摘要展示，失败不阻断 Gate。与 parent_options 同用 `show -s` 的 %h/%s 形态。
    pub(crate) fn head_commit_summary(&self) -> Option<(String, String)> {
        let output = self
            .run_readonly(&["show", "-s", "--format=%h%x1f%s", "HEAD"])
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let raw = text(&output.stdout);
        let raw = raw.trim_end_matches(['\r', '\n']);
        let (short_oid, subject) = raw.split_once('\x1f')?;
        if short_oid.is_empty() {
            return None;
        }
        Some((short_oid.to_owned(), subject.to_owned()))
    }

    pub(crate) fn is_bare(&self) -> Result<bool> {
        let output = self.run(&["rev-parse", "--is-bare-repository"])?;
        Ok(text(&output.stdout).trim() == "true")
    }

    pub(crate) fn is_linked_worktree(&self) -> Result<bool> {
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

    pub(crate) fn local_branch_exists(&self, branch: &str) -> Result<bool> {
        if branch.is_empty() || branch.starts_with('-') {
            return Ok(false);
        }
        let reference = format!("refs/heads/{branch}");
        let output = self.run(&["show-ref", "--verify", "--quiet", &reference])?;
        Ok(output.status.success())
    }

    /// 本地标签是否存在；选项注入形态直接判为不存在。
    pub(crate) fn tag_exists(&self, tag: &str) -> Result<bool> {
        if tag.is_empty() || tag.starts_with('-') {
            return Ok(false);
        }
        let reference = format!("refs/tags/{tag}");
        let output = self.run(&["show-ref", "--verify", "--quiet", &reference])?;
        Ok(output.status.success())
    }

    /// 已配置的 remote 数量；`git remote` 无输出时按 0 处理。
    pub(crate) fn remote_count(&self) -> Result<u32> {
        let output = self.run_readonly(&["remote"])?;
        if !output.status.success() {
            return Ok(0);
        }
        Ok(text(&output.stdout)
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count() as u32)
    }

    /// 本地缓存的远程跟踪引用是否存在（如 `refs/remotes/origin/main`）。
    pub(crate) fn remote_ref_exists(&self, ref_name: &str) -> Result<bool> {
        let output = self.run_readonly(&["rev-parse", "--verify", "--quiet", ref_name])?;
        Ok(output.status.success())
    }

    /// 当前分支上游引用（如 `origin/main`）；无 upstream 时返回 None。
    pub(crate) fn upstream(&self) -> Result<Option<String>> {
        let output =
            self.run_readonly(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])?;
        if !output.status.success() {
            return Ok(None);
        }
        let name = text(&output.stdout).trim().to_owned();
        Ok((!name.is_empty()).then_some(name))
    }

    /// `refs/stash` 的 reflog 条目数；无 stash 或引用不可读时按 0 处理。
    pub(crate) fn stash_count(&self) -> Result<u32> {
        let output = self.run_readonly(&["rev-list", "--walk-reflogs", "--count", "refs/stash"])?;
        if !output.status.success() {
            return Ok(0);
        }
        Ok(text(&output.stdout).trim().parse().unwrap_or(0))
    }

    /// 给定引用能否解析为 commit 对象；用于创建分支/标签的起点校验。
    pub(crate) fn commit_exists(&self, oid: &str) -> Result<bool> {
        if oid.is_empty() || oid.starts_with('-') {
            return Ok(false);
        }
        let object = format!("{oid}^{{commit}}");
        let output = self.run_readonly(&["rev-parse", "--verify", "--quiet", &object])?;
        Ok(output.status.success())
    }

    /// 返回占用目标分支的其他 worktree 路径（当前 worktree 的同名分支已单独判断）。
    pub(crate) fn worktree_owner(
        &self,
        branch: &str,
        current: Option<&str>,
    ) -> Result<Option<String>> {
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

    pub(crate) fn commit_parents(&self, oid: &str) -> Result<Vec<String>> {
        let output = self.run(&["rev-list", "--no-walk", "--parents", oid, "--"])?;
        if !output.status.success() {
            return Err(
                UserVisibleError::new(ErrorCode::InvalidArgument, "提交不存在或无法读取")
                    .with_key("errors.commandCommitUnreadable")
                    .with_detail(text(&output.stderr)),
            );
        }
        let line = text(&output.stdout);
        let mut parts = line.split_whitespace();
        let _self_oid = parts.next();
        Ok(parts.map(|value| value.to_owned()).collect())
    }

    /// 按 `-m N` 的 1 起始顺序生成父提交选项；短 OID 与标题由 Git CLI 提供，
    /// 展示信息读取失败时退回前 8 位 OID 与空标题，不阻断 Gate。
    pub(crate) fn parent_options(&self, parent_oids: &[String]) -> Result<Vec<ParentOptionDto>> {
        let mut options = Vec::with_capacity(parent_oids.len());
        for parent in parent_oids {
            let oid = git_core::Oid::new(parent.clone()).map_err(|e| {
                UserVisibleError::new(ErrorCode::GitCommandFailed, "无法解析父提交 OID")
                    .with_key("errors.commandParentOidInvalid")
                    .with_detail(e.to_string())
            })?;
            let output = self.run_readonly(&["show", "-s", "--format=%h%x1f%s", parent])?;
            let raw = text(&output.stdout);
            let raw = raw.trim_end_matches(['\r', '\n']);
            let (short_oid, summary) = match raw.split_once('\x1f') {
                Some((short_oid, summary)) if !short_oid.is_empty() => {
                    (short_oid.to_owned(), summary.to_owned())
                }
                _ => (oid.short(8).to_owned(), String::new()),
            };
            options.push(ParentOptionDto {
                oid,
                short_oid,
                summary,
            });
        }
        Ok(options)
    }

    pub(crate) fn run(&self, args: &[&str]) -> Result<Output> {
        run_git_output(
            Some(self.root.as_path()),
            args,
            &[("GIT_TERMINAL_PROMPT", "0")],
        )
        .map_err(|e| {
            UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                .with_key("errors.commandSpawnFailed")
                .with_detail(e.to_string())
        })
    }

    /// `status` 默认会拿可选索引锁并创建/删除 index.lock，本应用监听到 .git 变化后
    /// 又触发刷新，形成「刷新 → status → 监听 → 刷新」的自激循环并冲掉当前页；
    /// 关掉可选锁后 status 不再写锁文件，工作区状态结果不变。
    pub(crate) fn run_readonly(&self, args: &[&str]) -> Result<Output> {
        run_git_output(
            Some(self.root.as_path()),
            args,
            &[("GIT_OPTIONAL_LOCKS", "0"), ("GIT_TERMINAL_PROMPT", "0")],
        )
        .map_err(|e| {
            UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                .with_key("errors.commandSpawnFailed")
                .with_detail(e.to_string())
        })
    }
}
