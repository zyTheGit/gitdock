//! Git 配置读写的单元与端到端测试（自 app 层 gitconfig 随实现迁移）。
//! 端到端用例沿用 HOME 隔离夹具：注入沙箱主目录、不预设 local user.name，
//! 以验证用户级与仓库级两层取值；语义特殊，故不收敛至 test-support。

use super::values::MAX_VALUE_CHARS;
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
    git(&["init", "-q", "."]); // 沙箱夹具：HOME 注入隔离用户级配置、不预设 local 署名，语义特殊故不收敛至 test-support
    git(&["config", "--local", "core.safecrlf", "true"]);
    repo
}
