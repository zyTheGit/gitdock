//! 暂存区视图：状态分组、变更统计与单文件 diff 构建。

use std::collections::{HashMap, HashSet};

use git_core::{
    apply_patch_limit, binary_note, language_for, lossy_text as text, too_large_note, ErrorCode,
    FileDiffDto, FileStatus, Result, StagingFileDto, StagingStatusDto, UserVisibleError,
    WarningDto, MAX_DIFF_BYTES,
};

use crate::status::StatusEntry;
use crate::GitWriteModule;

/// 单次批量暂存的文件上限；足够覆盖常规操作，同时限制路径列表与命令耗时。
pub(crate) const MAX_STAGING_PATHS: usize = 1000;

struct Numstat {
    additions: u32,
    deletions: u32,
    binary: bool,
}

impl GitWriteModule {
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
                warnings: vec![WarningDto::new(
                    "staging_bare_empty",
                    "bare 仓库没有工作区，暂存区为空",
                )],
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
            warnings.push(
                WarningDto::new(
                    "conflicted_index",
                    format!(
                        "存在 {} 个未解决冲突文件，暂存区操作已禁用；请在终端解决后继续",
                        detail.summary.conflicted
                    ),
                )
                .with_arg("n", detail.summary.conflicted.to_string()),
            );
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
            )
            .with_key("errors.stagingInvalidPath")
            .with_arg("path", path));
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
                .with_key("errors.stagingFileMissing")
                .with_arg("path", path)
            })?;
        if entry.conflicted {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "冲突文件需要在终端解决，应用内不提供冲突 diff",
            )
            .with_key("errors.stagingConflictedDiff"));
        }
        if entry.untracked {
            if staged {
                return Err(UserVisibleError::new(
                    ErrorCode::InvalidArgument,
                    "未跟踪文件尚未暂存",
                )
                .with_key("errors.stagingUntrackedNotStaged"));
            }
            return self.untracked_diff(entry);
        }
        if staged && entry.index_code == '.' {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("{path} 没有已暂存改动"),
            )
            .with_key("errors.stagingNoStagedChanges")
            .with_arg("path", path));
        }
        if !staged && entry.worktree_code == '.' {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                format!("{path} 没有未暂存改动"),
            )
            .with_key("errors.stagingNoUnstagedChanges")
            .with_arg("path", path));
        }
        self.tracked_diff(entry, staged)
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
                    .with_key("errors.stagingNumstatFailed")
                    .with_detail(text(&output.stderr)),
            );
        }
        Ok(parse_numstat_z(&output.stdout))
    }

    fn untracked_diff(&self, entry: &StatusEntry) -> Result<FileDiffDto> {
        let full = self.root.join(&entry.path);
        let meta = std::fs::symlink_metadata(&full).map_err(|err| {
            UserVisibleError::new(ErrorCode::Io, format!("无法读取 {}", entry.path))
                .with_key("errors.stagingReadFileFailed")
                .with_arg("path", entry.path.clone())
                .with_detail(err.to_string())
        })?;
        if meta.file_type().is_symlink() {
            return Ok(note_diff(
                &entry.path,
                FileStatus::Added,
                "staging_symlink",
                "未跟踪的符号链接，不展开链接目标内容",
            ));
        }
        if !meta.is_file() {
            return Ok(note_diff(
                &entry.path,
                FileStatus::Added,
                "staging_not_regular_file",
                "该路径不是普通文件，无法显示 diff",
            ));
        }
        if meta.len() > MAX_DIFF_BYTES as u64 {
            let mut dto = note_diff(
                &entry.path,
                FileStatus::Added,
                "diff_too_large",
                &too_large_note(),
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
            .with_key("errors.stagingUntrackedDiffFailed")
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
                    .with_key("errors.stagingDiffFailed")
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
        note_code: None,
        note_args: None,
    };
    if binary {
        dto.set_note("diff_binary", binary_note());
        return dto;
    }
    if gitlink {
        dto.set_note("staging_gitlink", "子模块（gitlink）变更，请在终端查看");
        return dto;
    }
    if patch_text.trim().is_empty() {
        dto.set_note("staging_no_text_diff", "没有可显示的文本差异");
        return dto;
    }
    apply_patch_limit(&mut dto, patch_text);
    dto
}

fn note_diff(path: &str, status: FileStatus, code: &str, note: &str) -> FileDiffDto {
    let mut dto = FileDiffDto {
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
        note: None,
        note_code: None,
        note_args: None,
    };
    dto.set_note(code, note);
    dto
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

pub(crate) fn pathspec_stdin(
    paths: &Option<Vec<String>>,
    entries: Option<&[StatusEntry]>,
) -> Vec<u8> {
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
pub(crate) fn safe_rel_path(path: &str) -> bool {
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
