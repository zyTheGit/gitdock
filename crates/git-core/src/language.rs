//! 文件路径到语法高亮语言的纯映射。
//!
//! 读写模块共用同一份映射，避免 git-read 与 git-write 各维护一套扩展名表。

pub fn language_for(path: &str) -> Option<String> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    let language = match ext.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "toml" => "toml",
        "yml" | "yaml" => "yaml",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "sh" | "bash" => "bash",
        "ps1" => "powershell",
        "sql" => "sql",
        "xml" => "xml",
        "vue" => "vue",
        "svelte" => "svelte",
        _ => return None,
    };
    Some(language.to_owned())
}
