use super::check::{
    ensure_release_page, https_config, parse_release_with_platform, LATEST_RELEASE_URL,
};
use super::cleanup_cache;
use super::download::{is_allowed_download_url, parse_sha256sums, safe_asset_filename};
use git_core::ErrorCode;
use ureq::tls::{RootCerts, TlsProvider};

#[test]
fn https_config_selects_the_compiled_tls_provider() {
    let tls = https_config().tls_config().clone();
    assert_eq!(tls.provider(), TlsProvider::NativeTls);
    assert!(matches!(tls.root_certs(), RootCerts::PlatformVerifier));
}

fn payload(tag: &str, url: &str) -> String {
    format!(r#"{{"tag_name":"{tag}","html_url":"{url}","published_at":"2026-11-02T06:40:11Z"}}"#)
}

fn payload_with_assets(tag: &str, assets_json: &str, body: &str) -> String {
    format!(
        r#"{{"tag_name":"{tag}","html_url":"{PAGE}","published_at":"2026-11-02T06:40:11Z","body":"{body}","assets":{assets_json}}}"#
    )
}

const PAGE: &str = "https://github.com/zyTheGit/gitdock/releases/tag/v0.2.0";

#[test]
fn release_endpoint_is_pinned_to_this_repository() {
    assert_eq!(
        LATEST_RELEASE_URL,
        "https://api.github.com/repos/zyTheGit/gitdock/releases/latest"
    );
}

#[test]
fn newer_tag_strips_prefix_and_reports_update_available() {
    let (dto, _) =
        parse_release_with_platform(&payload("v0.2.0", PAGE), "0.1.0", "windows", "x86_64")
            .expect("解析失败");
    assert!(dto.available);
    assert!(!dto.current_newer);
    assert_eq!(dto.latest_version, "0.2.0");
    assert_eq!(dto.current_version, "0.1.0");
    assert_eq!(dto.page_url, PAGE);
    assert_eq!(dto.published_at.as_deref(), Some("2026-11-02"));
    assert!(!dto.can_download);
}

#[test]
fn same_version_reports_no_update() {
    let (dto, _) =
        parse_release_with_platform(&payload("0.1.0", PAGE), "0.1.0", "windows", "x86_64")
            .expect("解析失败");
    assert!(!dto.available);
    assert!(!dto.current_newer);
}

#[test]
fn older_tag_never_prompts_downgrade() {
    let (dto, _) =
        parse_release_with_platform(&payload("v0.1.0", PAGE), "0.2.0", "windows", "x86_64")
            .expect("解析失败");
    assert!(!dto.available);
    assert!(dto.current_newer);
}

#[test]
fn mislabeled_installed_version_is_flagged_as_newer_than_latest() {
    let (dto, _) =
        parse_release_with_platform(&payload("v0.2.3", PAGE), "3.0.1-rc-2", "windows", "x86_64")
            .expect("解析失败");
    assert!(!dto.available);
    assert!(dto.current_newer);
    assert_eq!(dto.latest_version, "0.2.3");
}

#[test]
fn prerelease_tag_is_not_offered_as_newer() {
    let (dto, _) =
        parse_release_with_platform(&payload("v0.2.0-rc.1", PAGE), "0.2.0", "windows", "x86_64")
            .expect("解析失败");
    assert!(!dto.available);
}

#[test]
fn two_digit_component_outperforms_lexical_compare() {
    let (dto, _) =
        parse_release_with_platform(&payload("v0.10.0", PAGE), "0.9.0", "windows", "x86_64")
            .expect("解析失败");
    assert!(dto.available);
}

#[test]
fn malformed_tag_is_rejected() {
    let err =
        parse_release_with_platform(&payload("nightly-2026", PAGE), "0.1.0", "windows", "x86_64")
            .expect_err("应拒绝非 semver");
    assert_eq!(err.code, ErrorCode::Internal);
}

#[test]
fn non_json_body_is_rejected() {
    let err =
        parse_release_with_platform("<html>rate limited</html>", "0.1.0", "windows", "x86_64")
            .expect_err("应拒绝非 JSON");
    assert_eq!(err.code, ErrorCode::Internal);
}

#[test]
fn release_url_outside_repository_is_rejected() {
    let body = payload("v0.2.0", "https://example.test/evil.exe");
    let err = parse_release_with_platform(&body, "0.1.0", "windows", "x86_64")
        .expect_err("应拒绝站外下载地址");
    assert_eq!(err.code, ErrorCode::Internal);
}

#[test]
fn matches_platform_assets_and_requires_checksums() {
    let dl = "https://github.com/zyTheGit/gitdock/releases/download/v0.4.0";
    let assets = format!(
        r#"[
          {{"name":"GitDock_0.4.0_x64-setup.exe","browser_download_url":"{dl}/GitDock_0.4.0_x64-setup.exe","size":12345}},
          {{"name":"GitDock_0.4.0_aarch64.dmg","browser_download_url":"{dl}/GitDock_0.4.0_aarch64.dmg","size":23456}},
          {{"name":"GitDock_0.4.0_amd64.deb","browser_download_url":"{dl}/GitDock_0.4.0_amd64.deb","size":34567}},
          {{"name":"SHA256SUMS.txt","browser_download_url":"{dl}/SHA256SUMS.txt","size":256}}
        ]"#
    );
    let json = payload_with_assets("v0.4.0", &assets, "  新增应用内下载  ");

    let (win_dto, win_target) =
        parse_release_with_platform(&json, "0.3.3", "windows", "x86_64").unwrap();
    assert!(win_dto.can_download);
    assert_eq!(
        win_dto.asset_name.as_deref(),
        Some("GitDock_0.4.0_x64-setup.exe")
    );
    assert_eq!(win_dto.asset_size, Some(12345));
    assert_eq!(win_dto.release_notes.as_deref(), Some("新增应用内下载"));
    assert!(win_target.is_some());

    let (mac_dto, _) = parse_release_with_platform(&json, "0.3.3", "macos", "aarch64").unwrap();
    assert!(mac_dto.can_download);
    assert_eq!(
        mac_dto.asset_name.as_deref(),
        Some("GitDock_0.4.0_aarch64.dmg")
    );

    let (linux_dto, _) = parse_release_with_platform(&json, "0.3.3", "linux", "x86_64").unwrap();
    assert!(linux_dto.can_download);
    assert_eq!(
        linux_dto.asset_name.as_deref(),
        Some("GitDock_0.4.0_amd64.deb")
    );

    let (intel_mac, _) = parse_release_with_platform(&json, "0.3.3", "macos", "x86_64").unwrap();
    assert!(!intel_mac.can_download);

    let no_sums = payload_with_assets(
        "v0.4.0",
        &format!(
            r#"[{{"name":"GitDock_0.4.0_x64-setup.exe","browser_download_url":"{dl}/GitDock_0.4.0_x64-setup.exe","size":12345}}]"#
        ),
        "",
    );
    let (no_sums_dto, no_sums_target) =
        parse_release_with_platform(&no_sums, "0.3.3", "windows", "x86_64").unwrap();
    assert!(!no_sums_dto.can_download);
    assert!(no_sums_target.is_none());

    let evil_assets = payload_with_assets(
        "v0.4.0",
        &format!(
            r#"[
              {{"name":"GitDock_0.4.0_x64-setup.exe","browser_download_url":"https://evil.test/a-setup.exe","size":123}},
              {{"name":"SHA256SUMS.txt","browser_download_url":"{dl}/SHA256SUMS.txt","size":64}}
            ]"#
        ),
        "",
    );
    let (evil_dto, _) =
        parse_release_with_platform(&evil_assets, "0.3.3", "windows", "x86_64").unwrap();
    assert!(!evil_dto.can_download);
}

#[test]
fn opened_page_is_validated_on_the_rust_side() {
    assert!(ensure_release_page(PAGE).is_ok());
    assert!(ensure_release_page(
        "https://github.com/zyTheGit/gitdock/releases/download/v0.2.0/a.exe"
    )
    .is_ok());
    for rejected in [
        "https://github.com/zyTheGit/git-graph/releases/tag/v0.1.0",
        "https://github.com.evil.test/zyTheGit/gitdock/releases/tag/v0.2.0",
        "http://github.com/zyTheGit/gitdock/releases/tag/v0.2.0",
        "file:///C:/Windows/System32/calc.exe",
    ] {
        let err = ensure_release_page(rejected).expect_err("应拒绝非本仓库发布页");
        assert_eq!(err.code, ErrorCode::Internal);
    }
}

#[test]
fn parse_sha256sums_matches_exact_filename_and_ignores_others() {
    let hash_a = "a".repeat(64);
    let hash_b = "B".repeat(64);
    let text = format!(
        "{hash_a}  GitDock_0.4.0_x64-setup.exe\n{hash_b} *GitDock_0.4.0_aarch64.dmg\nbadhash  other.deb\n"
    );
    assert_eq!(
        parse_sha256sums(&text, "GitDock_0.4.0_x64-setup.exe").as_deref(),
        Some(hash_a.as_str())
    );
    assert_eq!(
        parse_sha256sums(&text, "GitDock_0.4.0_aarch64.dmg").as_deref(),
        Some("b".repeat(64).as_str())
    );
    assert!(parse_sha256sums(&text, "other.deb").is_none());
    assert!(parse_sha256sums(&text, "missing.exe").is_none());
}

#[test]
fn is_allowed_download_url_enforces_https_and_github_hosts() {
    assert!(is_allowed_download_url(
        "https://github.com/zyTheGit/gitdock/releases/download/v0.4.0/a.exe"
    ));
    assert!(is_allowed_download_url(
        "https://objects.githubusercontent.com/github-production-release-asset/123"
    ));
    assert!(is_allowed_download_url(
        "https://release-assets.githubusercontent.com/file"
    ));
    assert!(!is_allowed_download_url(
        "http://github.com/zyTheGit/gitdock/releases/download/v0.4.0/a.exe"
    ));
    assert!(!is_allowed_download_url("https://evil-github.com/a.exe"));
    assert!(!is_allowed_download_url(
        "https://githubusercontent.com.evil.test/a.exe"
    ));
}

#[test]
fn safe_asset_filename_rejects_traversal() {
    assert_eq!(
        safe_asset_filename("GitDock_0.4.0_x64-setup.exe").unwrap(),
        "GitDock_0.4.0_x64-setup.exe"
    );
    for bad in ["", "../a.exe", "dir/a.exe", "dir\\a.exe", "a\0.exe"] {
        assert!(safe_asset_filename(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn cleanup_cache_removes_stale_versions_and_part_files() {
    let temp = tempfile::TempDir::new().unwrap();
    let root = temp.path();
    std::fs::create_dir_all(root.join("0.3.2")).unwrap();
    std::fs::write(root.join("0.3.2/old.exe"), b"old").unwrap();
    std::fs::create_dir_all(root.join("0.3.3")).unwrap();
    std::fs::write(root.join("0.3.3/cur.exe"), b"cur").unwrap();
    std::fs::create_dir_all(root.join("0.4.0")).unwrap();
    std::fs::write(root.join("0.4.0/new.exe"), b"new").unwrap();
    std::fs::write(root.join("0.4.0/new.exe.part"), b"part").unwrap();
    std::fs::write(root.join("stray.part"), b"stray").unwrap();

    cleanup_cache(root, "0.3.3");

    assert!(!root.join("0.3.2").exists());
    assert!(!root.join("0.3.3").exists());
    assert!(!root.join("stray.part").exists());
    assert!(root.join("0.4.0/new.exe").is_file());
    assert!(!root.join("0.4.0/new.exe.part").exists());
}
