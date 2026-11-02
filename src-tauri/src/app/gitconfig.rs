//! Git 配置的读写：用户级（`--global`）与当前仓库（`--local`）两个作用域。
//!
//! 只开放 `KNOWN_KEYS` 白名单里的键，界面既不能提交任意键名也不能提交命令，避免把
//! 配置写入变成任意执行入口。生效值与来源一次读取（`--list --show-scope`）：Git 按
//! system → global → worktree → local 的顺序输出，同一键后出现的覆盖先出现的。
//!
//! `--global` 的目标文件由子进程的 `HOME` 决定，所以测试一律走 `*_with_home` 入口注入
//! 沙箱主目录；直接调用公开 `read` / `save` 会解析真实 `HOME`，可能写进开发机的 `~/.gitconfig`。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Output;

use git_core::{git_command, ErrorCode, Result, UserVisibleError};
use serde::{Deserialize, Serialize};

/// 界面可读写的全局键，顺序即展示顺序。
pub const KNOWN_KEYS: [&str; 5] = [
    "user.name",
    "user.email",
    "core.autocrlf",
    "init.defaultBranch",
    "pull.rebase",
];

const MAX_VALUE_CHARS: usize = 200;

/// 取值受限的键：只接受列出的字面量，布尔开关不接受任意字符串。
const CHOICE_KEYS: [(&str, &[&str]); 2] = [
    ("core.autocrlf", &["true", "false", "input"]),
    ("pull.rebase", &["true", "false", "interactive"]),
];

/// 分支名里不允许出现的字符（配合下面的 `..`、`@{`、`.lock` 等序列检查）。
const FORBIDDEN_IN_BRANCH: [char; 7] = ['~', '^', ':', '?', '*', '[', '\\'];

/// 写入目标：用户级配置文件，或当前仓库的 `.git/config`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigScope {
    User,
    Repo,
}

impl ConfigScope {
    fn flag(self) -> &'static str {
        match self {
            Self::User => "--global",
            Self::Repo => "--local",
        }
    }

    /// Git 在 `--show-scope` 里对本作用域的写法；`worktree` 属于仓库侧。
    fn matches_scope(self, raw: &str) -> bool {
        match self {
            Self::User => raw == "global",
            Self::Repo => raw == "local" || raw == "worktree",
        }
    }
}

/// 保存请求里的一项；`value` 为空串表示在所选作用域删除该键。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntryDto {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigValueDto {
    pub key: String,
    /// 各作用域里显式写过的值；没写过就是 None。未打开仓库时 `repo` 恒为 None。
    pub user: Option<String>,
    pub repo: Option<String>,
    pub system: Option<String>,
    /// 真正生效的值，以及它来自哪一层（`user` / `repo` / `system` / `command`）。
    pub effective: Option<String>,
    pub effective_scope: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitConfigDto {
    /// 用户级配置文件位置，仅用于展示；Git 可能同时读 XDG 与 `~/.gitconfig`。
    pub user_file_paths: Vec<String>,
    /// 当前仓库路径与它的配置文件位置；未打开仓库时为 None。
    pub repo_path: Option<String>,
    pub repo_file_path: Option<String>,
    /// 始终包含 `KNOWN_KEYS` 全部键。
    pub entries: Vec<ConfigValueDto>,
}

/// 读取两个作用域的配置。`repo` 为当前仓库根目录，None 时只读用户级与系统级。
pub fn read(repo: Option<&Path>) -> Result<GitConfigDto> {
    read_with_home(&home_dir()?, repo)
}

/// 把条目应用到所选作用域，返回重新读取后的配置，界面据此回显真实落盘结果。
pub fn save(
    scope: ConfigScope,
    repo: Option<&Path>,
    entries: &[ConfigEntryDto],
) -> Result<GitConfigDto> {
    save_with_home(scope, &home_dir()?, repo, entries)
}

/// 用户主目录显式传入的版本：`--global` 的读写目标完全由 `home` 决定，测试用它指向沙箱目录，
/// 避免继承到进程的真实 `HOME` 而写到开发机的 `~/.gitconfig`。
fn save_with_home(
    scope: ConfigScope,
    home: &Path,
    repo: Option<&Path>,
    entries: &[ConfigEntryDto],
) -> Result<GitConfigDto> {
    // 项目级必须有仓库；用户级即使开着仓库也照写，回读时保留仓库层，界面才能继续显示生效来源。
    let repo_path = match scope {
        ConfigScope::Repo => Some(require_repo(repo)?),
        ConfigScope::User => repo.map(Path::to_path_buf),
    };
    let cwd = repo_path.as_deref().unwrap_or(home);
    let mut explicit = scoped_values(cwd, home, scope)?;
    for entry in entries {
        let key = canonical_key(&entry.key).ok_or_else(|| {
            UserVisibleError::new(ErrorCode::InvalidArgument, "不支持读写该 Git 配置项")
                .with_detail(entry.key.clone())
        })?;
        let value = validate_value(key, &entry.value)?;
        if value.is_empty() {
            if explicit.remove(key).is_some() {
                let output = run_git(cwd, home, &["config", scope.flag(), "--unset-all", key])?;
                ensure_success(&output, "删除配置项失败")?;
            }
        } else {
            let output = run_git(
                cwd,
                home,
                &["config", scope.flag(), "--replace-all", key, &value],
            )?;
            ensure_success(&output, "写入配置项失败")?;
            explicit.insert(key, value);
        }
    }
    read_with_home(home, repo_path.as_deref())
}

fn read_with_home(home: &Path, repo: Option<&Path>) -> Result<GitConfigDto> {
    let cwd = repo.unwrap_or(home);
    let output = run_git(cwd, home, &["config", "--list", "--show-scope"])?;
    ensure_success(&output, "读取 Git 配置失败")?;
    let rows = parse_scoped_list(&lossy(&output.stdout));
    let entries = KNOWN_KEYS
        .iter()
        .map(|key| {
            let effective = effective_value(&rows, key);
            ConfigValueDto {
                key: (*key).to_owned(),
                user: scope_value(&rows, key, ConfigScope::User),
                repo: repo.and_then(|_| scope_value(&rows, key, ConfigScope::Repo)),
                system: scope_value_named(&rows, key, "system"),
                effective: effective.as_ref().map(|(_, value)| value.clone()),
                effective_scope: effective
                    .as_ref()
                    .map(|(scope, _)| scope_label(scope).to_owned()),
            }
        })
        .collect();
    Ok(GitConfigDto {
        user_file_paths: config_file_paths(home),
        repo_path: repo.map(|path| path.display().to_string()),
        repo_file_path: repo.and_then(|path| repo_config_path(path, home)),
        entries,
    })
}

/// 取某键在某作用域的最后一次出现（Git 自己也是后者覆盖前者）。
fn scope_value(rows: &[ScopedEntry], key: &str, scope: ConfigScope) -> Option<String> {
    rows.iter()
        .filter(|row| row.key == key && scope.matches_scope(&row.scope))
        .map(|row| row.value.clone())
        .next_back()
}

fn scope_value_named(rows: &[ScopedEntry], key: &str, scope: &str) -> Option<String> {
    rows.iter()
        .filter(|row| row.key == key && row.scope == scope)
        .map(|row| row.value.clone())
        .next_back()
}

/// 生效项 = 该键最后一次出现，与 Git 的解析顺序一致。
fn effective_value<'a>(rows: &'a [ScopedEntry], key: &str) -> Option<(&'a str, String)> {
    rows.iter()
        .filter(|row| row.key == key)
        .map(|row| (row.scope.as_str(), row.value.clone()))
        .next_back()
}

fn scope_label(raw: &str) -> &'static str {
    match raw {
        "global" => "user",
        "local" | "worktree" => "repo",
        "system" => "system",
        _ => "command",
    }
}

fn require_repo(repo: Option<&Path>) -> Result<PathBuf> {
    repo.map(Path::to_path_buf).ok_or_else(|| {
        UserVisibleError::new(ErrorCode::NotARepository, "未打开仓库，无法读写项目级配置")
    })
}

struct ScopedEntry {
    scope: String,
    key: &'static str,
    value: String,
}

fn scoped_values(
    cwd: &Path,
    home: &Path,
    scope: ConfigScope,
) -> Result<BTreeMap<&'static str, String>> {
    let output = run_git(cwd, home, &["config", "--list", "--show-scope"])?;
    ensure_success(&output, "读取 Git 配置失败")?;
    let rows = parse_scoped_list(&lossy(&output.stdout));
    Ok(KNOWN_KEYS
        .iter()
        .filter_map(|key| scope_value(&rows, key, scope).map(|value| (*key, value)))
        .collect())
}

/// 解析 `git config --list --show-scope` 的每行 `scope<TAB>key=value`，只留白名单键。
fn parse_scoped_list(text: &str) -> Vec<ScopedEntry> {
    let mut rows = Vec::new();
    for line in text.lines() {
        let Some((raw_scope, rest)) = line.split_once('\t') else {
            continue;
        };
        let Some((raw_key, value)) = split_entry(rest) else {
            continue;
        };
        let Some(key) = canonical_key(raw_key) else {
            continue;
        };
        rows.push(ScopedEntry {
            scope: raw_scope.trim().to_lowercase(),
            key,
            value: normalize(key, value),
        });
    }
    rows
}

/// 枚举键的取值可能写成 True / FALSE，统一成界面选项的小写形式；其余原样保留。
fn normalize(key: &'static str, value: &str) -> String {
    match CHOICE_KEYS.iter().find(|(name, _)| *name == key) {
        Some((_, choices)) => choices
            .iter()
            .find(|choice| **choice == value.to_lowercase())
            .map(|choice| (*choice).to_owned())
            .unwrap_or_else(|| value.to_owned()),
        None => value.to_owned(),
    }
}

/// 拆出键与值；值里的 `=` 属于内容，只在第一个 `=` 处切分。键可能被 Git 加引号。
fn split_entry(line: &str) -> Option<(&str, &str)> {
    if let Some(rest) = line.strip_prefix('"') {
        let (key, tail) = rest.split_once("\"=")?;
        return Some((key, tail));
    }
    line.split_once('=')
}

/// Git 配置键名大小写不敏感，界面上的写法也不固定，统一映射回白名单写法。
fn canonical_key(raw: &str) -> Option<&'static str> {
    let lowered = raw.trim().to_lowercase();
    KNOWN_KEYS
        .iter()
        .find(|key| key.to_lowercase() == lowered)
        .copied()
}

/// 返回去掉首尾空白的值；空值代表删除。控制字符与超长值一律拒绝。
fn validate_value(key: &str, raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().any(char::is_control) {
        return Err(invalid(key, "配置值不能包含换行或控制字符"));
    }
    if value.chars().count() > MAX_VALUE_CHARS {
        return Err(invalid(
            key,
            &format!("配置值长度需小于 {MAX_VALUE_CHARS} 个字符"),
        ));
    }
    if let Some((_, choices)) = CHOICE_KEYS.iter().find(|(name, _)| *name == key) {
        let lowered = value.to_lowercase();
        return match choices.iter().find(|choice| **choice == lowered) {
            Some(choice) => Ok((*choice).to_owned()),
            None => Err(invalid(
                key,
                &format!("只能取 {} 之一", choices.join(" / ")),
            )),
        };
    }
    // 姓名允许空格（如 "Jane Doe"），邮箱与分支名不允许；其余键各自单独把关。
    match key {
        "user.email" => {
            if value.chars().any(char::is_whitespace) {
                return Err(invalid(key, "邮箱不能包含空格"));
            }
            if !value.contains('@') || value.starts_with('@') || value.ends_with('@') {
                return Err(invalid(key, "邮箱格式无效，需要包含 @ 且前后有内容"));
            }
        }
        "init.defaultBranch" => {
            if value.chars().any(char::is_whitespace) {
                return Err(invalid(key, "分支名不能包含空格"));
            }
            if value.contains("..")
                || value.contains("@{")
                || value.contains(FORBIDDEN_IN_BRANCH.as_ref())
                || value.starts_with('/')
                || value.ends_with('/')
                || value.ends_with(".lock")
            {
                return Err(invalid(key, "不是合法的分支名"));
            }
        }
        _ => {}
    }
    Ok(value.to_owned())
}

fn invalid(key: &str, message: &str) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::InvalidArgument, format!("{key} {message}"))
}

/// Git 按 `HOME`（Windows 下退回 `USERPROFILE`）定位用户级配置。这里把 `HOME` 显式设为
/// 与 `home_dir()` 一致的目录，读写目标才和界面展示的路径一致，测试也能指向沙箱目录。
fn run_git(cwd: &Path, home: &Path, args: &[&str]) -> Result<Output> {
    git_command()
        .current_dir(cwd)
        .args(args)
        .env("HOME", home)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| {
            UserVisibleError::new(ErrorCode::GitMissing, "无法启动 git 命令")
                .with_detail(e.to_string())
        })
}

fn ensure_success(output: &Output, message: &str) -> Result<()> {
    if output.status.success() {
        return Ok(());
    }
    Err(UserVisibleError::new(ErrorCode::GitCommandFailed, message)
        .with_detail(lossy(&output.stderr).trim().to_owned()))
}

/// Git 的路径与值可能含非 UTF-8 字节；展示用文本做有损转换，不因编码问题中断读写。
fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Git 自身的查找顺序：`HOME` 优先，其次用户主目录。
fn home_dir() -> Result<PathBuf> {
    ["HOME", "USERPROFILE"]
        .iter()
        .filter_map(|var| std::env::var_os(var).map(PathBuf::from))
        .find(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| UserVisibleError::new(ErrorCode::Io, "无法定位用户主目录"))
}

/// 用户级配置文件位置只用于展示。Git 2.32 起可用 `git var` 查询，且可能一次报出多个文件
/// （XDG 配置与 `~/.gitconfig` 都算用户级）；更早版本退回主目录推导。
fn config_file_paths(home: &Path) -> Vec<String> {
    if let Ok(output) = run_git(home, home, &["var", "GIT_CONFIG_GLOBAL"]) {
        if output.status.success() {
            let paths = parse_path_list(&lossy(&output.stdout));
            if !paths.is_empty() {
                return paths;
            }
        }
    }
    vec![fallback_config_path(home).display().to_string()]
}

/// 仓库配置文件位置：链接工作树各自有一份，因此交给 Git 自己解析。
fn repo_config_path(repo: &Path, home: &Path) -> Option<String> {
    let output = run_git(repo, home, &["rev-parse", "--absolute-git-dir"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let git_dir = lossy(&output.stdout).trim().to_owned();
    if git_dir.is_empty() {
        return None;
    }
    Some(PathBuf::from(git_dir).join("config").display().to_string())
}

fn parse_path_list(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn fallback_config_path(home: &Path) -> PathBuf {
    home.join(".gitconfig")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, value: &str) -> ConfigEntryDto {
        ConfigEntryDto {
            key: key.to_owned(),
            value: value.to_owned(),
        }
    }

    fn value_of<'a>(dto: &'a GitConfigDto, key: &str) -> Option<&'a ConfigValueDto> {
        dto.entries.iter().find(|entry| entry.key == key)
    }
    #[test]
    fn scoped_list_maps_each_scope_and_effective_winner() {
        let rows = parse_scoped_list(
            "system\tuser.name=系统名\nglobal\tuser.name=用户名\nlocal\tuser.name=仓库名\n",
        );
        let entry = value_of_key(&rows, "user.name");
        assert_eq!(
            scope_value(&rows, "user.name", ConfigScope::User).as_deref(),
            Some("用户名")
        );
        assert_eq!(
            scope_value(&rows, "user.name", ConfigScope::Repo).as_deref(),
            Some("仓库名")
        );
        assert_eq!(
            scope_value_named(&rows, "user.name", "system").as_deref(),
            Some("系统名")
        );
        assert_eq!(
            effective_value(&rows, "user.name")
                .map(|(_, v)| v)
                .as_deref(),
            Some("仓库名")
        );
        assert_eq!(scope_label(&entry.0), "repo");
    }

    #[test]
    fn scoped_list_ignores_keys_outside_whitelist() {
        let rows = parse_scoped_list(
            "global\tcore.fsmonitor=/tmp/evil.sh\nglobal\tuser.email=dev@example.com\n",
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].key, "user.email");
    }

    #[test]
    fn scoped_list_normalizes_choice_and_quoted_keys() {
        let rows = parse_scoped_list(
            "global\tcore.autocrlf=True\nlocal\t\"user.email\"=dev@example.com\n无作用域前缀的行\n",
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].value, "true");
        assert_eq!(rows[1].key, "user.email");
        assert_eq!(rows[1].scope, "local");
    }

    fn value_of_key(rows: &[ScopedEntry], key: &str) -> (String, String) {
        rows.iter()
            .rev()
            .find(|row| row.key == key)
            .map(|row| (row.scope.clone(), row.value.clone()))
            .unwrap_or_default()
    }

    #[test]
    fn unknown_key_is_rejected() {
        assert!(canonical_key("core.fsmonitor").is_none());
        assert_eq!(canonical_key(" USER.Name "), Some("user.name"));
    }

    #[test]
    fn empty_value_means_unset_without_other_checks() {
        assert_eq!(validate_value("user.email", "   ").unwrap(), "");
    }

    #[test]
    fn choice_keys_are_limited_and_normalized() {
        assert_eq!(validate_value("core.autocrlf", " TRUE ").unwrap(), "true");
        assert_eq!(
            validate_value("pull.rebase", "interactive").unwrap(),
            "interactive"
        );
        assert_eq!(
            validate_value("core.autocrlf", "yes").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }

    #[test]
    fn name_rejects_control_chars_and_length_but_keeps_spaces() {
        assert_eq!(
            validate_value("user.name", "张三\n李四").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            validate_value("user.name", &"名".repeat(MAX_VALUE_CHARS + 1))
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            validate_value("user.name", "Zhang San").unwrap(),
            "Zhang San"
        );
    }

    #[test]
    fn email_and_branch_values_are_checked() {
        assert_eq!(
            validate_value("user.email", "dev@example.com").unwrap(),
            "dev@example.com"
        );
        assert_eq!(
            validate_value("user.email", "dev example@.com")
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            validate_value("init.defaultBranch", "main").unwrap(),
            "main"
        );
        for bad in ["a..b", "feat~1", "a:b", "release/", "x.lock", "a@{b", "a b"] {
            assert_eq!(
                validate_value("init.defaultBranch", bad).unwrap_err().code,
                ErrorCode::InvalidArgument,
                "{bad} 应被拒绝"
            );
        }
    }

    #[test]
    fn path_list_keeps_every_reported_file() {
        let paths = parse_path_list("C:/Users/me/.config/git/config\nC:/Users/me/.gitconfig\n");
        assert_eq!(paths.len(), 2);
        assert!(paths[1].ends_with(".gitconfig"));
        assert!(parse_path_list("  \n\n").is_empty());
    }

    #[test]
    fn fallback_config_path_uses_home_dir() {
        assert_eq!(
            fallback_config_path(Path::new("C:/Users/me")),
            PathBuf::from("C:/Users/me/.gitconfig")
        );
    }

    /// 端到端：真实 git 在沙箱主目录 + 沙箱仓库里读写，验证两层取值与不误伤其它键。
    #[test]
    fn user_and_repo_scopes_resolve_effective_value_with_real_git() {
        let home = tempfile::tempdir().expect("创建沙箱主目录失败");
        std::fs::write(
            home.path().join(".gitconfig"),
            "[user]\n\tname = 用户级署名\n\temail = user@example.com\n[core]\n\tsafecrlf = true\n",
        )
        .expect("写入沙箱用户级配置失败");
        let repo = init_repo(home.path());

        let dto = read_with_home(home.path(), Some(repo.path())).expect("读取两层配置失败");
        assert_eq!(
            value_of(&dto, "user.name").and_then(|e| e.user.as_deref()),
            Some("用户级署名")
        );
        assert_eq!(
            value_of(&dto, "user.name").and_then(|e| e.effective.as_deref()),
            Some("用户级署名")
        );
        assert_eq!(
            value_of(&dto, "user.name").and_then(|e| e.effective_scope.as_deref()),
            Some("user")
        );
        // 未打开仓库时不报仓库级的值。
        let user_only = read_with_home(home.path(), None).expect("仅用户级读取失败");
        assert_eq!(
            value_of(&user_only, "user.name").and_then(|e| e.repo.as_deref()),
            None
        );
        assert!(user_only.repo_path.is_none());

        // 仓库级覆盖用户级，且只写进 .git/config。
        save_with_home(
            ConfigScope::Repo,
            home.path(),
            Some(repo.path()),
            &[entry("user.name", " 仓库级署名 ")],
        )
        .expect("写入仓库级配置失败");
        let after = read_with_home(home.path(), Some(repo.path())).expect("二次读取失败");
        let name = value_of(&after, "user.name").unwrap();
        assert_eq!(name.repo.as_deref(), Some("仓库级署名"));
        assert_eq!(name.user.as_deref(), Some("用户级署名"));
        assert_eq!(name.effective.as_deref(), Some("仓库级署名"));
        assert_eq!(name.effective_scope.as_deref(), Some("repo"));
        let repo_config = std::fs::read_to_string(repo.path().join(".git").join("config")).unwrap();
        assert!(repo_config.contains("name = 仓库级署名"), "{repo_config}");
        // 用户级文件保持原样。
        let user_config = std::fs::read_to_string(home.path().join(".gitconfig")).unwrap();
        assert!(user_config.contains("name = 用户级署名"), "{user_config}");

        // 用户级写入后回读的是同一个仓库的两层取值：切换到用户级不会丢掉仓库级来源。
        let returned = save_with_home(
            ConfigScope::User,
            home.path(),
            Some(repo.path()),
            &[entry("user.email", " new@example.com ")],
        )
        .expect("写入用户级配置失败");
        assert_eq!(
            returned.repo_path.as_deref(),
            Some(repo.path().to_str().unwrap())
        );
        assert_eq!(
            value_of(&returned, "user.email").and_then(|e| e.effective.as_deref()),
            Some("new@example.com")
        );
        assert_eq!(
            value_of(&returned, "user.name").and_then(|e| e.effective_scope.as_deref()),
            Some("repo")
        );
        let repo_config = std::fs::read_to_string(repo.path().join(".git").join("config")).unwrap();
        assert!(!repo_config.contains("email"), "{repo_config}");
        let user_config = std::fs::read_to_string(home.path().join(".gitconfig")).unwrap();
        assert!(
            user_config.contains("email = new@example.com"),
            "{user_config}"
        );

        // 删除仓库级覆盖后，生效值回落到用户级。
        save_with_home(
            ConfigScope::Repo,
            home.path(),
            Some(repo.path()),
            &[entry("user.name", "")],
        )
        .unwrap();
        let reverted = read_with_home(home.path(), Some(repo.path())).unwrap();
        let name = value_of(&reverted, "user.name").unwrap();
        assert_eq!(name.repo, None);
        assert_eq!(name.effective.as_deref(), Some("用户级署名"));
        assert_eq!(name.effective_scope.as_deref(), Some("user"));
    }

    #[test]
    fn repo_scope_without_repository_is_rejected() {
        let home = tempfile::tempdir().expect("创建沙箱主目录失败");
        let err = save_with_home(
            ConfigScope::Repo,
            home.path(),
            None,
            &[entry("user.name", "任意")],
        )
        .expect_err("未打开仓库应拒绝写项目级配置");
        assert_eq!(err.code, ErrorCode::NotARepository);
        // 校验发生在任何写入之前。
        assert!(!home.path().join(".gitconfig").exists());
    }

    #[test]
    fn save_rejects_unknown_key_and_bad_value_without_touching_file() {
        let home = tempfile::tempdir().expect("创建沙箱主目录失败");
        std::fs::write(home.path().join(".gitconfig"), "[user]\n\tname = 原值\n").unwrap();

        let err = save_with_home(
            ConfigScope::User,
            home.path(),
            None,
            &[entry("core.fsmonitor", "/tmp/evil.sh")],
        )
        .expect_err("白名单外的键应被拒绝");
        assert_eq!(err.code, ErrorCode::InvalidArgument);

        let err = save_with_home(
            ConfigScope::User,
            home.path(),
            None,
            &[entry("user.email", "not-an-email")],
        )
        .expect_err("非法邮箱应被拒绝");
        assert_eq!(err.code, ErrorCode::InvalidArgument);

        let content = std::fs::read_to_string(home.path().join(".gitconfig")).unwrap();
        assert_eq!(content, "[user]\n\tname = 原值\n");
    }

    fn init_repo(home: &Path) -> tempfile::TempDir {
        let repo = tempfile::tempdir().expect("创建沙箱仓库失败");
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(repo.path())
                .args(args)
                .env("HOME", home)
                .output()
                .expect("启动 git 失败");
            assert!(
                output.status.success(),
                "{args:?} {}",
                lossy(&output.stderr)
            );
        };
        git(&["init", "-q", "."]);
        git(&["config", "--local", "core.safecrlf", "true"]);
        repo
    }
}
