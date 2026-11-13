//! 写命令构造。

use git_core::{
    ErrorCode, HeadDto, InterruptionKind, PullMode, Result, UserVisibleError, WriteKind,
    WriteRequest,
};

use crate::branch;
use crate::commit::{commit_args, MessageFile};
use crate::description::validate_branch_description;
use crate::history;
use crate::remote;
use crate::staging::pathspec_stdin;
use crate::stash;
use crate::tag;
use crate::GitWriteModule;

pub(crate) struct CommandSpec {
    pub(crate) args: Vec<String>,
    pub(crate) stdin: Option<Vec<u8>>,
    pub(crate) description_write: bool,
    /// 提交消息临时文件；spec 存续期间有效，drop 时无条件删除（含失败与错误路径）。
    pub(crate) message_file: Option<MessageFile>,
}

pub(crate) struct HeadInfo {
    pub(crate) branch: Option<String>,
    pub(crate) detached: bool,
    pub(crate) unborn: bool,
}

impl HeadInfo {
    pub(crate) fn dto(&self) -> HeadDto {
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

impl GitWriteModule {
    pub(crate) fn command_for(&self, request: &WriteRequest) -> Result<CommandSpec> {
        let mut spec = CommandSpec {
            args: Vec::new(),
            stdin: None,
            description_write: false,
            message_file: None,
        };
        let mut message_file = None;
        spec.args = match request.kind {
            WriteKind::CherryPick => {
                let mut args = vec!["cherry-pick".to_owned()];
                push_mainline(&mut args, request.mainline);
                args.extend(require_oids(request)?);
                args
            }
            WriteKind::Revert => {
                let mut args = vec!["revert".to_owned()];
                push_mainline(&mut args, request.mainline);
                args.push("--no-edit".to_owned());
                args.extend(require_oids(request)?);
                args
            }
            WriteKind::SwitchBranch => vec![
                "switch".into(),
                "--no-guess".into(),
                request.branch.clone().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?,
            ],
            WriteKind::SetBranchDescription => {
                let branch = request.branch.clone().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                let key = format!("branch.{branch}.description");
                let value = request.description.clone().unwrap_or_default();
                // 兜底校验：即使调用方绕过 Gate，也不允许选项注入与非法字符写入配置。
                validate_branch_description(&value)?;
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
            WriteKind::ContinueOperation | WriteKind::AbortOperation => {
                let (action, _) = interruption_command(request)?;
                let flag = if request.kind == WriteKind::ContinueOperation {
                    "--continue"
                } else {
                    "--abort"
                };
                vec![action.to_owned(), flag.to_owned()]
            }
            WriteKind::CreateCommit | WriteKind::AmendCommit => {
                // Gate 已拒绝空消息；此处兜底再拦一次，防调用方绕过 Gate。
                let message = request.message.as_deref().unwrap_or("");
                if message.trim().is_empty() {
                    return Err(UserVisibleError::new(
                        ErrorCode::InvalidArgument,
                        "提交消息不能为空",
                    )
                    .with_key("errors.gateEmptyMessage"));
                }
                let file = MessageFile::create(message)?;
                let args = commit_args(request.kind == WriteKind::AmendCommit, &file);
                message_file = Some(file);
                args
            }
            WriteKind::CreateBranch => {
                let name = request.branch.clone().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                branch::create_args(&name, request.oid.as_ref().map(|oid| oid.as_str()))
            }
            WriteKind::DeleteBranch => {
                let name = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                branch::delete_args(name)
            }
            WriteKind::DeleteBranchRemote => {
                let name = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                remote::delete_remote_branch_args(name)
            }
            WriteKind::DeleteTagRemote => remote::delete_remote_tag_args(require_tag(request)?),
            WriteKind::RenameBranch => {
                let name = request.branch.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
                        .with_key("errors.commandMissingBranch")
                })?;
                let new_name = request.new_name.as_deref().ok_or_else(|| {
                    UserVisibleError::new(ErrorCode::InvalidArgument, "缺少新分支名")
                        .with_key("errors.commandMissingNewName")
                })?;
                // Gate 已校验新分支名；此处兜底拒绝选项注入。
                if new_name.is_empty() || new_name.starts_with('-') {
                    return Err(UserVisibleError::new(
                        ErrorCode::InvalidArgument,
                        "新分支名不合法",
                    )
                    .with_key("errors.gateInvalidBranchName"));
                }
                branch::rename_args(name, new_name)
            }
            WriteKind::CreateTag => {
                let name = require_tag(request)?;
                let target = request
                    .oid
                    .as_ref()
                    .map(|oid| oid.as_str())
                    .unwrap_or("HEAD");
                match request
                    .message
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                {
                    Some(message) => tag::annotated_args(name, message, target),
                    None => tag::lightweight_args(name, target),
                }
            }
            WriteKind::DeleteTag => tag::delete_args(require_tag(request)?),
            WriteKind::SetTagDescription => {
                let name = require_tag(request)?;
                tag::set_description_args(
                    name,
                    &format!("refs/tags/{name}^{{commit}}"),
                    request.description.as_deref().unwrap_or(""),
                )?
            }
            WriteKind::StashSave => stash::save_args(
                request.message.as_deref(),
                request.include_untracked.unwrap_or(false),
            ),
            WriteKind::StashApply => stash::apply_args(require_stash(request)?),
            WriteKind::StashPop => stash::pop_args(require_stash(request)?),
            WriteKind::StashDrop => stash::drop_args(require_stash(request)?),
            WriteKind::Fetch => remote::fetch_args(),
            WriteKind::Pull => remote::pull_args(request.pull_mode.unwrap_or(PullMode::FfOnly)),
            WriteKind::Push => remote::push_args(),
            WriteKind::Merge => history::merge_args(require_branch_name(request)?),
            WriteKind::Rebase => history::rebase_args(require_branch_name(request)?),
        };
        spec.description_write = request.kind == WriteKind::SetBranchDescription;
        spec.message_file = message_file;
        Ok(spec)
    }
}

/// stash apply/pop/drop 必须携带 `stash@{N}`；Gate 已校验范围，这里兜底非空。
fn require_stash(request: &WriteRequest) -> Result<&str> {
    request.stash.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少 stash 选择器")
            .with_key("errors.commandMissingStash")
    })
}

/// 仅在提供了合法（1 起始）父序号时追加 `-m N`；范围由 Gate 校验。
fn push_mainline(args: &mut Vec<String>, mainline: Option<u32>) {
    if let Some(mainline) = mainline.filter(|value| *value >= 1) {
        args.push("-m".to_owned());
        args.push(mainline.to_string());
    }
}

/// 批量 cherry-pick / revert 使用 oids；未提供时回退单 OID。
fn require_oids(request: &WriteRequest) -> Result<Vec<String>> {
    let list: Vec<String> = request
        .oids
        .as_ref()
        .filter(|oids| !oids.is_empty())
        .map(|oids| oids.iter().map(|oid| oid.to_string()).collect())
        .unwrap_or_else(|| {
            request
                .oid
                .as_ref()
                .map(|oid| vec![oid.to_string()])
                .unwrap_or_default()
        });
    if list.is_empty() {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "缺少提交 OID")
                .with_key("errors.commandMissingOid"),
        );
    }
    Ok(list)
}

/// 标签操作的目标名必须非空且不能是选项注入形态。
fn require_tag(request: &WriteRequest) -> Result<&str> {
    let tag = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少标签名")
            .with_key("errors.commandMissingTag")
    })?;
    if tag.is_empty() || tag.starts_with('-') {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "标签名不合法")
                .with_key("errors.commandMissingTag"),
        );
    }
    Ok(tag)
}

/// merge / rebase 的目标分支必须非空且不能是选项注入形态。
fn require_branch_name(request: &WriteRequest) -> Result<&str> {
    let branch = request.branch.as_deref().ok_or_else(|| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "缺少分支名")
            .with_key("errors.commandMissingBranch")
    })?;
    if branch.is_empty() || branch.starts_with('-') {
        return Err(
            UserVisibleError::new(ErrorCode::InvalidArgument, "分支名不合法")
                .with_key("errors.gateInvalidBranchName"),
        );
    }
    Ok(branch)
}

/// 继续/中止对应的 Git 子命令与操作标记；拒绝其他中断类型。
pub(crate) fn interruption_command(
    request: &WriteRequest,
) -> Result<(&'static str, Vec<&'static str>)> {
    match request.interruption {
        Some(InterruptionKind::CherryPick) => Ok(("cherry-pick", vec!["CHERRY_PICK_HEAD"])),
        Some(InterruptionKind::Revert) => Ok(("revert", vec!["REVERT_HEAD"])),
        Some(InterruptionKind::Merge) => Ok(("merge", vec!["MERGE_HEAD"])),
        Some(InterruptionKind::Rebase) => Ok((
            "rebase",
            vec!["REBASE_HEAD", "rebase-merge", "rebase-apply"],
        )),
        _ => Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "继续/中止需要有效的 Git 中断类型",
        )
        .with_key("errors.commandInterruptionKindInvalid")),
    }
}
