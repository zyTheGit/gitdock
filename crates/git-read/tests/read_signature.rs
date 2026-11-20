//! 提交签名头标注（ADR-0034 §4）：伪造 gpgsig 头 → gpg / ssh / x509 / unknown；
//! 普通提交不带标注。签名体不进入 DTO。

mod common;

use std::io::Write;
use std::path::Path;

use common::*;
use git_core::Oid;
use test_support::{commit, current_head, git_ok, init_temp_repo, oid_of};

/// 用 `git hash-object -t commit -w --stdin` 写入带任意附加头的提交，返回 OID。
fn write_commit(repo: &Path, content: &str) -> Oid {
    let mut child = std::process::Command::new("git")
        .args([
            "-C",
            repo.to_str().expect("仓库路径"),
            "hash-object",
            "-t",
            "commit",
            "-w",
            "--stdin",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("启动 hash-object");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(content.as_bytes())
        .expect("写入 commit 内容");
    let output = child.wait_with_output().expect("等待 hash-object");
    assert!(output.status.success(), "hash-object 失败");
    oid_of(String::from_utf8_lossy(&output.stdout).trim())
}

/// 构造一段 `gpgsig` 附加头；续行按 Git 约定以一个空格开头。
fn gpgsig_header(body: &str) -> String {
    let mut header = String::from("gpgsig ");
    let mut lines = body.lines();
    if let Some(first) = lines.next() {
        header.push_str(first);
    }
    for line in lines {
        header.push('\n');
        if !line.is_empty() {
            header.push(' ');
        }
        header.push_str(line);
    }
    header
}

fn signed_commit(repo: &Path, tree: &str, parent: &str, header: &str) -> Oid {
    let content = format!(
        "tree {tree}\nparent {parent}\nauthor Test <test@example.com> 1700000000 +0000\ncommitter Test <test@example.com> 1700000000 +0000\n{header}\n\nsigned commit\n"
    );
    write_commit(repo, &content)
}

#[test]
fn signature_kind_is_classified_from_extra_headers() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let parent = current_head(dir);
    let tree = git_ok(dir, &["rev-parse", "HEAD^{tree}"]);
    let read = module(dir);

    for (body, expected) in [
        (
            "-----BEGIN PGP SIGNATURE-----\n\niQIzBAABCAAdFiEE\n-----END PGP SIGNATURE-----",
            "gpg",
        ),
        (
            "-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----",
            "ssh",
        ),
        (
            "-----BEGIN SIGNED MESSAGE-----\nMIAGCSqGSIb3\n-----END SIGNED MESSAGE-----",
            "x509",
        ),
        (
            "-----BEGIN WHAT IS THIS-----\nabc\n-----END WHAT IS THIS-----",
            "unknown",
        ),
    ] {
        let oid = signed_commit(dir, &tree, &parent, &gpgsig_header(body));
        let detail = read.read_commit(&oid).expect("读取签名提交");
        assert_eq!(detail.signature_kind.as_deref(), Some(expected), "{body}");
        // 签名体不进入 DTO：详情 JSON 里只有类型。
        let json = serde_json::to_string(&detail).expect("序列化详情");
        assert!(!json.contains("BEGIN"), "签名体不应外泄");
    }

    // 普通提交没有签名头，字段不出现。
    let plain = oid_of(&current_head(dir));
    let detail = read.read_commit(&plain).expect("读取普通提交");
    assert!(detail.signature_kind.is_none());
    let json = serde_json::to_string(&detail).expect("序列化详情");
    assert!(!json.contains("signature_kind"), "{json}");
}

#[test]
fn sha256_style_gpgsig_header_is_also_detected() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let parent = current_head(dir);
    let tree = git_ok(dir, &["rev-parse", "HEAD^{tree}"]);
    let header =
        gpgsig_header("-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----")
            .replacen("gpgsig ", "gpgsig-sha256 ", 1);
    let oid = signed_commit(dir, &tree, &parent, &header);
    let detail = module(dir).read_commit(&oid).expect("读取签名提交");
    assert_eq!(detail.signature_kind.as_deref(), Some("ssh"));
}
