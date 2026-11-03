//! porcelain v2 工作区状态解析与汇总。

use git_core::{lossy_text as text, ErrorCode, Result, UserVisibleError, WorkspaceStatusDto};

use crate::GitWriteModule;

pub(crate) struct StatusSummary {
    pub(crate) staged: u32,
    pub(crate) tracked: u32,
    pub(crate) untracked: u32,
    pub(crate) conflicted: u32,
    pub(crate) conflicted_files: Vec<String>,
}

pub(crate) struct StatusEntry {
    pub(crate) path: String,
    pub(crate) old_path: Option<String>,
    pub(crate) index_code: char,
    pub(crate) worktree_code: char,
    pub(crate) untracked: bool,
    pub(crate) conflicted: bool,
}

pub(crate) struct StatusDetail {
    pub(crate) summary: StatusSummary,
    pub(crate) entries: Vec<StatusEntry>,
}

impl GitWriteModule {
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

    pub(crate) fn status_detail(&self) -> Result<StatusDetail> {
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

    pub(crate) fn status_summary(&self) -> Result<StatusSummary> {
        Ok(self.status_detail()?.summary)
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
