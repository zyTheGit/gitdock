//! Git 配置的读写：用户级（`--global`）与当前仓库（`--local`）两个作用域。
//!
//! 只开放 `KNOWN_KEYS` 白名单里的键，界面既不能提交任意键名也不能提交命令，避免把
//! 配置写入变成任意执行入口。生效值与来源一次读取（`--list --show-scope`）：Git 按
//! system → global → worktree → local 的顺序输出，同一键后出现的覆盖先出现的。
//!
//! 项目级（`--local`）写的是 `.git/config`，保存须经 `GitWriteModule::save_git_config`
//! 持写互斥锁，与 cherry-pick / 暂存等写操作互斥；用户级只写用户主目录下的配置文件，
//! 不与仓库写操作竞争，无需持锁。
//!
//! `--global` 的目标文件由子进程的 `HOME` 决定，所以测试一律走 `*_with_home` 入口注入
//! 沙箱主目录；直接调用公开 `read_git_config` / `save_git_config*` 会解析真实 `HOME`，
//! 可能写进开发机的 `~/.gitconfig`。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Output;

use git_core::{git_command, ErrorCode, Result, UserVisibleError};
use serde::{Deserialize, Serialize};

use self::values::{normalize, validate_value};
use crate::GitWriteModule;

mod values;

/// 界面可读写的全局键，顺序即展示顺序。
pub const KNOWN_KEYS: [&str; 5] = [
    "user.name",
    "user.email",
    "core.autocrlf",
    "init.defaultBranch",
    "pull.rebase",
];

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

/// 读取两个作用域的配置。`repo` 为当前仓库根目录，None 时只读用户级与系统级；
/// 读取不改仓库状态，无需写互斥。
pub fn read_git_config(repo: Option<&Path>) -> Result<GitConfigDto> {
    read_with_home(&home_dir()?, repo)
}

/// 未打开仓库时的保存入口：只可能保存用户级（项目级由 `save_with_home` 的仓库校验
/// 拒绝，错误语义与原先一致）。有仓库会话时必须经 [`GitWriteModule::save_git_config`]
/// 接入写互斥，勿走此入口。
pub fn save_git_config_without_repo(
    scope: ConfigScope,
    entries: &[ConfigEntryDto],
) -> Result<GitConfigDto> {
    save_with_home(scope, &home_dir()?, None, entries)
}

impl GitWriteModule {
    /// 把条目应用到所选作用域，返回重新读取后的配置，界面据此回显真实落盘结果。
    ///
    /// 项目级写 `.git/config`，先取 `write_lock` 与其他写操作互斥（与 `execute` 同一
    /// 把锁、同一忙语义）；用户级只写用户级文件，不触碰仓库，无需持锁。
    pub fn save_git_config(
        &self,
        scope: ConfigScope,
        repo: Option<&Path>,
        entries: &[ConfigEntryDto],
    ) -> Result<GitConfigDto> {
        let home = home_dir()?;
        if scope == ConfigScope::Repo {
            let _guard = self.write_lock.try_lock().ok_or_else(|| {
                UserVisibleError::new(ErrorCode::Internal, "已有写操作正在进行，请稍后再试")
            })?;
            save_with_home(scope, &home, repo, entries)
        } else {
            save_with_home(scope, &home, repo, entries)
        }
    }
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

/// Git 按 `HOME`（Windows 下退回 `USERPROFILE`）定位用户级配置。这里把 `HOME` 显式设为
/// 与 `home_dir()` 一致的目录，读写目标才和界面展示的路径一致，测试也能指向沙箱目录。
/// 与 command.rs 的 `run` / `run_readonly` 共用 `git_core::git_command` 底座，但二者
/// 绑定模块根目录且不注入 `HOME`，故此处保留独立封装。
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
mod tests;
