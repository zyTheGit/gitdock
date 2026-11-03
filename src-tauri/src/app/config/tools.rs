//! 外部对比工具：配置结构、内置探测与保存前校验。

use git_core::{ErrorCode, UserVisibleError};
use serde::{Deserialize, Serialize};

use super::SettingsDto;

const MAX_TEMPLATE_LEN: usize = 4000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalToolConfig {
    pub name: String,
    pub executable: String,
    pub args_template: String,
}

pub(super) fn seed_tools(settings: &mut SettingsDto, tools: Vec<ExternalToolConfig>) {
    settings.tools_seeded = true;
    if !settings.external_tools.is_empty() || tools.is_empty() {
        return;
    }
    if settings.default_tool.is_none() {
        settings.default_tool = Some(tools[0].name.clone());
    }
    settings.external_tools = tools;
}

/// 按当前系统探测常见对比工具；路径探测收敛在 platform 层（ADR-0005），
/// 本函数只负责把 GitDock 语义的参数模板绑定到探测结果上。
pub(super) fn detected_tools() -> Vec<ExternalToolConfig> {
    crate::app::platform::detect_tools()
        .into_iter()
        .map(|tool| ExternalToolConfig {
            name: tool.name.to_owned(),
            executable: tool.path.display().to_string(),
            args_template: args_template_for(tool.name).to_owned(),
        })
        .collect()
}

/// 探测命中工具的参数模板（GitDock 语义，非平台语义）：`--diff` 是
/// VS Code / Zed 的命令行语义，Beyond Compare 直接接两个文件。
/// platform 层新增探测工具时须在此补充分支；未知名字退回裸模板兜底。
fn args_template_for(name: &str) -> &'static str {
    match name {
        "VS Code" | "Zed" => "--diff $LOCAL $REMOTE",
        "Beyond Compare" => "$LOCAL $REMOTE",
        _ => "$LOCAL $REMOTE",
    }
}

pub(super) fn normalize_default_tool(settings: &mut SettingsDto) {
    let Some(name) = settings.default_tool.as_deref() else {
        return;
    };
    let trimmed = name.trim();
    if trimmed.is_empty()
        || !settings
            .external_tools
            .iter()
            .any(|tool| tool.name == trimmed)
    {
        settings.default_tool = None;
    } else if trimmed != name {
        settings.default_tool = Some(trimmed.to_owned());
    }
}

pub(super) fn validate(settings: &SettingsDto) -> Result<(), UserVisibleError> {
    for tool in &settings.external_tools {
        if tool.name.trim().is_empty() || tool.executable.trim().is_empty() {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "外部工具的名称与可执行文件不能为空",
            )
            .with_key("errors.externalToolNameOrExecutableEmpty"));
        }
        if tool.args_template.len() > MAX_TEMPLATE_LEN {
            return Err(
                UserVisibleError::new(ErrorCode::InvalidArgument, "外部工具参数模板过长")
                    .with_key("errors.externalToolTemplateTooLong"),
            );
        }
        if tool.args_template.contains('\0') || tool.executable.contains('\0') {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "外部工具配置包含非法字符",
            )
            .with_key("errors.externalToolInvalidCharacter"));
        }
    }
    Ok(())
}
