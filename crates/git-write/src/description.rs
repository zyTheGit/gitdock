//! 分支描述：读取、写入值校验与结果文案。

use git_core::{
    lossy_text as text, BranchDescriptionDto, ErrorCode, Result, UserVisibleError, WriteRequest,
};

use crate::GitWriteModule;

impl GitWriteModule {
    pub fn read_branch_description(&self, branch: &str) -> Result<BranchDescriptionDto> {
        if !self.local_branch_exists(branch)? {
            return Err(UserVisibleError::new(
                ErrorCode::BranchNotFound,
                format!("本地分支 {branch} 不存在"),
            )
            .with_key("errors.descriptionBranchMissing")
            .with_arg("branch", branch));
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
}

/// 分支描述写入值的长度上限；与 config 模块对 user.name 的上限保持一致量级。
const MAX_BRANCH_DESCRIPTION_CHARS: usize = 200;

/// 校验分支描述写入值：trim 后为空代表清空（合法）；非空值拒绝以 "-" 开头
/// （会被 `git config` 解析为选项）、控制字符（含换行）与超长输入。
pub(crate) fn validate_branch_description(raw: &str) -> Result<()> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(());
    }
    if value.starts_with('-') {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "分支描述不能以 \"-\" 开头，该值会被 Git 当作选项解析",
        )
        .with_key("errors.descriptionLeadingDash"));
    }
    if value.chars().any(char::is_control) {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            "分支描述不能包含换行或控制字符",
        )
        .with_key("errors.descriptionControlChars"));
    }
    if value.chars().count() > MAX_BRANCH_DESCRIPTION_CHARS {
        return Err(UserVisibleError::new(
            ErrorCode::InvalidArgument,
            format!("分支描述长度需小于 {MAX_BRANCH_DESCRIPTION_CHARS} 个字符"),
        )
        .with_key("errors.descriptionTooLong")
        .with_arg("max", MAX_BRANCH_DESCRIPTION_CHARS.to_string()));
    }
    Ok(())
}

pub(crate) fn description_message(request: &WriteRequest, removed: bool) -> String {
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
