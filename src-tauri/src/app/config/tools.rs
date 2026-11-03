//! 外部对比工具：配置结构、内置探测与保存前校验。

use std::path::PathBuf;

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

/// 按当前系统探测常见对比工具；只检查已知安装路径，不启动任何进程。
pub(super) fn detected_tools() -> Vec<ExternalToolConfig> {
    #[cfg(not(windows))]
    {
        Vec::new()
    }
    #[cfg(windows)]
    {
        use std::env;
        let mut tools: Vec<ExternalToolConfig> = Vec::new();
        let mut add = |name: &str, exe: PathBuf, args: &str| {
            // 同一工具可能同时存在于用户目录与 Program Files，按名称去重。
            if tools.iter().any(|tool| tool.name == name) {
                return;
            }
            if exe.is_file() {
                tools.push(ExternalToolConfig {
                    name: name.to_owned(),
                    executable: exe.display().to_string(),
                    args_template: args.to_owned(),
                });
            }
        };
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local);
            add(
                "VS Code",
                base.join("Programs")
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
                "--diff $LOCAL $REMOTE",
            );
            add(
                "Zed",
                base.join("Programs")
                    .join("Zed")
                    .join("bin")
                    .join("zed.exe"),
                "--diff $LOCAL $REMOTE",
            );
        }
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = env::var_os(key) {
                let base = PathBuf::from(dir);
                add(
                    "VS Code",
                    base.join("Microsoft VS Code").join("Code.exe"),
                    "--diff $LOCAL $REMOTE",
                );
                add(
                    "Beyond Compare",
                    base.join("Beyond Compare 4").join("BCompare.exe"),
                    "$LOCAL $REMOTE",
                );
            }
        }
        tools
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
