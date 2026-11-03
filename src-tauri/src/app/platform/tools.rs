//! 常见外部对比工具的内置探测：三平台已知安装路径（自 config/tools.rs
//! 迁入，ADR-0005）。只检查路径存在性，不启动任何进程。

use std::path::PathBuf;

/// 探测结果：工具名 + 可执行文件绝对路径。参数模板（`--diff $LOCAL $REMOTE`
/// 等属于 GitDock 语义）由消费方 config::tools 绑定。
pub(crate) struct DetectedTool {
    pub name: &'static str,
    pub path: PathBuf,
}

/// 按当前系统探测常见对比工具（VS Code / Zed / Beyond Compare）。
/// 同一工具可能出现在多个候选路径，按名称去重、按候选顺序取首个命中。
pub(crate) fn detect_tools() -> Vec<DetectedTool> {
    let mut tools: Vec<DetectedTool> = Vec::new();
    let add = |tools: &mut Vec<DetectedTool>, name: &'static str, path: PathBuf| {
        if tools.iter().any(|tool| tool.name == name) {
            return;
        }
        if path.is_file() {
            tools.push(DetectedTool { name, path });
        }
    };

    #[cfg(windows)]
    {
        use std::env;
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let base = PathBuf::from(local);
            add(
                &mut tools,
                "VS Code",
                base.join("Programs")
                    .join("Microsoft VS Code")
                    .join("Code.exe"),
            );
            add(
                &mut tools,
                "Zed",
                base.join("Programs")
                    .join("Zed")
                    .join("bin")
                    .join("zed.exe"),
            );
        }
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(dir) = env::var_os(key) {
                let base = PathBuf::from(dir);
                add(
                    &mut tools,
                    "VS Code",
                    base.join("Microsoft VS Code").join("Code.exe"),
                );
                add(
                    &mut tools,
                    "Beyond Compare",
                    base.join("Beyond Compare 4").join("BCompare.exe"),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let applications = PathBuf::from("/Applications");
        add(
            &mut tools,
            "VS Code",
            applications
                .join("Visual Studio Code.app")
                .join("Contents")
                .join("Resources")
                .join("app")
                .join("bin")
                .join("code"),
        );
        add(
            &mut tools,
            "Beyond Compare",
            applications
                .join("Beyond Compare.app")
                .join("Contents")
                .join("MacOS")
                .join("bcomp"),
        );
        // Zed 的 CLI 不随 .app 装机，通常经 brew / 官方脚本装入用户或系统 bin。
        for dir in ["/usr/local/bin", "/opt/homebrew/bin"] {
            add(&mut tools, "Zed", PathBuf::from(dir).join("zed"));
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux 无统一安装位置：按 PATH 绝对条目扫描（防当前目录劫持约定见 paths.rs）。
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in super::absolute_path_entries(&paths) {
                add(&mut tools, "VS Code", dir.join("code"));
                add(&mut tools, "Zed", dir.join("zed"));
                add(&mut tools, "Beyond Compare", dir.join("bcompare"));
            }
        }
    }

    tools
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detected_tools_point_to_existing_files() {
        for tool in detect_tools() {
            assert!(
                tool.path.is_file(),
                "{} 探测结果应存在：{}",
                tool.name,
                tool.path.display()
            );
        }
    }

    #[test]
    fn tool_names_are_unique() {
        let tools = detect_tools();
        let mut names: Vec<&str> = tools.iter().map(|tool| tool.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), tools.len(), "同名工具应去重");
    }
}
