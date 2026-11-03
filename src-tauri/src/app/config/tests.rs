//! 应用配置模块的测试（自 mod.rs 拆出，按 AGENTS.md 测试分文件方向）。

// detected_tools 只被 Windows 专属测试引用；非 Windows 下避免 unused import。
#[cfg(windows)]
use super::tools::detected_tools;
use super::tools::seed_tools;
use super::*;

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("创建临时目录失败")
}

#[test]
fn missing_font_scale_defaults_to_one() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
    )
    .expect("写入旧版设置失败");
    assert_eq!(load(dir.path()).font_scale, 1.0);
}

#[test]
fn font_scale_roundtrips_when_saved() {
    let dir = temp_dir();
    let settings = SettingsDto {
        font_scale: 1.25,
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.font_scale, 1.25);
    assert_eq!(load(dir.path()).font_scale, 1.25);
}

#[test]
fn out_of_range_font_scale_is_rejected_on_save() {
    let dir = temp_dir();
    for scale in [0.5, 2.5, f64::NAN] {
        let settings = SettingsDto {
            font_scale: scale,
            ..Default::default()
        };
        let err = save(dir.path(), &settings).expect_err("应拒绝越界缩放");
        assert_eq!(err.code, ErrorCode::InvalidArgument);
    }
}

#[test]
fn out_of_range_font_scale_falls_back_to_one_on_load() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true,"font_scale":5.0}"#,
    )
    .expect("写入越界设置失败");
    assert_eq!(load(dir.path()).font_scale, 1.0);
}

#[test]
fn missing_language_defaults_to_system() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
    )
    .expect("写入旧版设置失败");
    assert_eq!(load(dir.path()).language, None);
}

#[test]
fn language_roundtrips_when_saved() {
    let dir = temp_dir();
    let settings = SettingsDto {
        language: Some("en".to_string()),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.language.as_deref(), Some("en"));
    assert_eq!(load(dir.path()).language.as_deref(), Some("en"));
}

#[test]
fn invalid_language_falls_back_to_system_on_load() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true,"language":"fr"}"#,
    )
    .expect("写入无效语言失败");
    assert_eq!(load(dir.path()).language, None);
}

#[test]
fn invalid_language_is_rejected_on_save() {
    let dir = temp_dir();
    let settings = SettingsDto {
        language: Some("fr".to_string()),
        ..Default::default()
    };
    let err = save(dir.path(), &settings).expect_err("应拒绝不支持的语言");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
}

#[test]
fn shell_profile_roundtrips_when_saved() {
    let dir = temp_dir();
    let settings = SettingsDto {
        shell_profile: "git_bash".to_string(),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.shell_profile, "git_bash");
    assert_eq!(load(dir.path()).shell_profile, "git_bash");
}

#[test]
fn missing_shell_profile_defaults_to_default() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
    )
    .expect("写入旧版设置失败");
    assert_eq!(load(dir.path()).shell_profile, "default");
}

#[test]
fn invalid_shell_profile_falls_back_on_load() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true,"shell_profile":"powershell_core"}"#,
    )
    .expect("写入无效启动器失败");
    assert_eq!(load(dir.path()).shell_profile, "default");
}

#[test]
fn invalid_shell_profile_is_rejected_on_save() {
    let dir = temp_dir();
    let settings = SettingsDto {
        shell_profile: "cmd".to_string(),
        ..Default::default()
    };
    let err = save(dir.path(), &settings).expect_err("应拒绝不支持的 Shell 启动器");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
}

#[test]
fn save_then_load_roundtrip_with_schema_version() {
    let dir = temp_dir();
    let settings = SettingsDto {
        restore_last_repository: false,
        window_width: Some(1200),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.schema_version, SCHEMA_VERSION);
    let loaded = load(dir.path());
    assert!(!loaded.restore_last_repository);
    assert_eq!(loaded.window_width, Some(1200));
    assert!(settings_path(dir.path()).exists());
}

#[test]
fn missing_watch_flag_defaults_to_enabled() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":1,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
    )
    .expect("写入旧版设置失败");
    assert!(load(dir.path()).watch_enabled);
}

#[test]
fn watch_flag_roundtrips_when_disabled() {
    let dir = temp_dir();
    let settings = SettingsDto {
        watch_enabled: false,
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert!(!saved.watch_enabled);
    assert!(!load(dir.path()).watch_enabled);
}

#[test]
fn save_keeps_all_recent_repositories() {
    let dir = temp_dir();
    let settings = SettingsDto {
        recent_repositories: (0..120)
            .map(|i| RecentRepository {
                path: format!("C:/repo/{i}"),
                last_opened_at: i as i64,
            })
            .collect(),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.recent_repositories.len(), 120);
    assert_eq!(saved.recent_repositories[0].path, "C:/repo/0");
    assert_eq!(
        save(dir.path(), &saved)
            .expect("二次保存失败")
            .recent_repositories
            .len(),
        120
    );
    assert_eq!(load(dir.path()).recent_repositories.len(), 120);
}

#[test]
fn corrupt_settings_are_backed_up_and_defaults_returned() {
    let dir = temp_dir();
    std::fs::write(settings_path(dir.path()), b"{ not json").expect("写入损坏设置失败");
    let loaded = load(dir.path());
    assert_eq!(loaded.schema_version, SCHEMA_VERSION);
    assert!(dir.path().join("settings.v0.bak").exists());
}

#[test]
fn stale_schema_is_backed_up() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(dir.path()),
        br#"{"schema_version":99,"recent_repositories":[],"external_tools":[],"restore_last_repository":true}"#,
    )
    .expect("写入旧版本设置失败");
    let loaded = load(dir.path());
    assert_eq!(loaded.schema_version, SCHEMA_VERSION);
    assert!(dir.path().join("settings.v99.bak").exists());
}

#[test]
fn remember_dedupes_existing_path_and_moves_to_front() {
    let dir = temp_dir();
    let repo = dir.path().join("Repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录失败");
    let canonical = strip_verbatim(&std::fs::canonicalize(&repo).expect("规范化路径失败"));
    let settings = SettingsDto {
        recent_repositories: vec![
            RecentRepository {
                path: canonical.clone(),
                last_opened_at: 1,
            },
            RecentRepository {
                path: "C:/other".to_string(),
                last_opened_at: 2,
            },
        ],
        ..Default::default()
    };
    let saved = remember(dir.path(), &settings, &repo).expect("记录最近仓库失败");
    assert_eq!(saved.recent_repositories.len(), 2);
    assert_eq!(
        saved.recent_repositories[0].path.replace('\\', "/"),
        canonical.replace('\\', "/")
    );
}

/// 大小写折叠去重仅 Windows/macOS（platform::same_path 语义，ADR-0005）；
/// Linux 文件系统大小写敏感，见下方对应用例。
#[cfg(not(target_os = "linux"))]
#[test]
fn remember_dedupes_case_insensitive_paths_and_moves_to_front() {
    let dir = temp_dir();
    let repo = dir.path().join("Repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录失败");
    // 大小写不同的同一份路径要以规范化结果为基准构造：临时目录本身可能带 8.3 短名
    // （如 CI 上的 C:\Users\RUNNER~1），而 canonicalize 会展开成长名。
    let canonical = strip_verbatim(&std::fs::canonicalize(&repo).expect("规范化路径失败"));
    let settings = SettingsDto {
        recent_repositories: vec![
            RecentRepository {
                path: canonical.to_uppercase(),
                last_opened_at: 1,
            },
            RecentRepository {
                path: "C:/other".to_string(),
                last_opened_at: 2,
            },
        ],
        ..Default::default()
    };
    let saved = remember(dir.path(), &settings, &repo).expect("记录最近仓库失败");
    assert_eq!(saved.recent_repositories.len(), 2);
    let first = saved.recent_repositories[0]
        .path
        .replace('\\', "/")
        .to_lowercase();
    assert_eq!(first, canonical.replace('\\', "/").to_lowercase());
}

/// Linux 大小写敏感：仅大小写不同的路径是两个真实仓库，不去重（A-3）。
#[cfg(target_os = "linux")]
#[test]
fn remember_keeps_case_variants_separately_on_linux() {
    let dir = temp_dir();
    let repo = dir.path().join("Repo");
    std::fs::create_dir_all(&repo).expect("创建仓库目录失败");
    let canonical = strip_verbatim(&std::fs::canonicalize(&repo).expect("规范化路径失败"));
    let settings = SettingsDto {
        recent_repositories: vec![
            RecentRepository {
                path: canonical.to_uppercase(),
                last_opened_at: 1,
            },
            RecentRepository {
                path: "C:/other".to_string(),
                last_opened_at: 2,
            },
        ],
        ..Default::default()
    };
    let saved = remember(dir.path(), &settings, &repo).expect("记录最近仓库失败");
    assert_eq!(saved.recent_repositories.len(), 3);
    assert_eq!(
        saved.recent_repositories[0].path.replace('\\', "/"),
        canonical.replace('\\', "/")
    );
}

#[test]
fn default_tool_is_cleared_when_tool_missing() {
    let dir = temp_dir();
    let settings = SettingsDto {
        external_tools: vec![ExternalToolConfig {
            name: "code".to_string(),
            executable: "Code.exe".to_string(),
            args_template: "--diff $LOCAL $REMOTE".to_string(),
        }],
        default_tool: Some("removed".to_string()),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.default_tool, None);
}

#[test]
fn default_tool_survives_when_tool_exists() {
    let dir = temp_dir();
    let settings = SettingsDto {
        external_tools: vec![ExternalToolConfig {
            name: "code".to_string(),
            executable: "Code.exe".to_string(),
            args_template: "--diff $LOCAL $REMOTE".to_string(),
        }],
        default_tool: Some(" code ".to_string()),
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert_eq!(saved.default_tool.as_deref(), Some("code"));
}

fn fake_tool(name: &str) -> ExternalToolConfig {
    ExternalToolConfig {
        name: name.to_string(),
        executable: format!("C:/tools/{name}.exe"),
        args_template: "--diff $LOCAL $REMOTE".to_string(),
    }
}

#[test]
fn seed_tools_uses_first_detected_tool_as_default() {
    let mut settings = SettingsDto::default();
    seed_tools(&mut settings, vec![fake_tool("VS Code"), fake_tool("Zed")]);
    assert!(settings.tools_seeded);
    assert_eq!(settings.external_tools.len(), 2);
    assert_eq!(settings.default_tool.as_deref(), Some("VS Code"));
}

#[test]
fn seed_tools_keeps_existing_tools_and_default() {
    let mut settings = SettingsDto {
        external_tools: vec![fake_tool("by")],
        default_tool: Some("by".to_string()),
        ..Default::default()
    };
    seed_tools(&mut settings, vec![fake_tool("VS Code")]);
    assert!(settings.tools_seeded);
    assert_eq!(settings.external_tools.len(), 1);
    assert_eq!(settings.external_tools[0].name, "by");
    assert_eq!(settings.default_tool.as_deref(), Some("by"));
}

#[test]
fn cleared_tools_are_not_reseeded_after_save() {
    let dir = temp_dir();
    let settings = SettingsDto {
        external_tools: Vec::new(),
        default_tool: None,
        ..Default::default()
    };
    let saved = save(dir.path(), &settings).expect("保存设置失败");
    assert!(saved.tools_seeded);
    // 用户主动清空后，后续启动不再注入探测到的内置工具。
    assert!(load(dir.path()).external_tools.is_empty());
}

#[cfg(windows)]
#[test]
fn detected_tools_point_to_existing_files() {
    for tool in detected_tools() {
        assert!(!tool.name.is_empty());
        assert!(!tool.args_template.is_empty());
        assert!(Path::new(&tool.executable).is_file(), "{}", tool.executable);
    }
}

#[test]
fn forget_removes_recent_entry_without_touching_others() {
    let dir = temp_dir();
    let settings = SettingsDto {
        recent_repositories: vec![
            RecentRepository {
                path: "C:/repo/a".to_string(),
                last_opened_at: 2,
            },
            RecentRepository {
                path: "C:/repo/b".to_string(),
                last_opened_at: 1,
            },
        ],
        ..Default::default()
    };
    let saved = forget(dir.path(), &settings, "C:/repo/a").expect("移除最近仓库失败");
    assert_eq!(saved.recent_repositories.len(), 1);
    assert_eq!(saved.recent_repositories[0].path, "C:/repo/b");
    assert_eq!(load(dir.path()).recent_repositories.len(), 1);
}

/// 大小写变体移除仅 Windows/macOS（platform::same_path 折叠语义）；
/// Linux 精确比较下大小写变体不是同一条目。
#[cfg(not(target_os = "linux"))]
#[test]
fn forget_matches_case_insensitive_paths() {
    let dir = temp_dir();
    let settings = SettingsDto {
        recent_repositories: vec![
            RecentRepository {
                path: "C:/repo/a".to_string(),
                last_opened_at: 2,
            },
            RecentRepository {
                path: "C:/repo/b".to_string(),
                last_opened_at: 1,
            },
        ],
        ..Default::default()
    };
    let saved = forget(dir.path(), &settings, "c:\\repo\\A").expect("移除最近仓库失败");
    assert_eq!(saved.recent_repositories.len(), 1);
    assert_eq!(saved.recent_repositories[0].path, "C:/repo/b");
}

#[test]
fn invalid_external_tool_is_rejected() {
    let dir = temp_dir();
    let settings = SettingsDto {
        external_tools: vec![ExternalToolConfig {
            name: "  ".to_string(),
            executable: "bc.exe".to_string(),
            args_template: "$LOCAL $REMOTE".to_string(),
        }],
        ..Default::default()
    };
    let err = save(dir.path(), &settings).expect_err("应拒绝空名称");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
}
