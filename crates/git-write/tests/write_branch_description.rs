//! 分支描述写入：Gate 校验、往返读写与选项注入 / 控制字符 / 长度上限拒绝。

mod common;

use common::*;
use git_core::{WriteKind, WriteStatus};
use git_write::GitWriteModule;
use test_support::{commit, git_ok, init_temp_repo};

#[test]
fn branch_description_roundtrip_uses_local_config() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");

    let outcome = module
        .execute(&request(
            WriteKind::SetBranchDescription,
            None,
            Some("main"),
            Some("主线说明"),
        ))
        .expect("写入描述");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");

    let read = module.read_branch_description("main").expect("读取描述");
    assert_eq!(read.description, "主线说明");
    assert_eq!(
        git_ok(
            dir,
            &["config", "--local", "--get", "branch.main.description"]
        )
        .trim(),
        "主线说明"
    );
    assert!(!read.shared_across_worktrees);

    let cleared = module
        .execute(&request(
            WriteKind::SetBranchDescription,
            None,
            Some("main"),
            Some("  "),
        ))
        .expect("清空描述");
    assert_eq!(cleared.status, WriteStatus::Succeeded, "{cleared:?}");
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        ""
    );
}

#[test]
fn valid_description_is_written_after_gate_validation() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("集成与发布主线"),
    );

    let report = module.validate(&request).expect("Gate");
    assert!(report.ok, "{:?}", report.issues);
    let outcome = module.execute(&request).expect("写入描述");
    assert_eq!(outcome.status, WriteStatus::Succeeded, "{outcome:?}");
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        "集成与发布主线"
    );
}

#[test]
fn rejects_description_starting_with_dash() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("--list"),
    );

    let error = module.validate(&request).expect_err("以 - 开头应被拒绝");
    assert!(
        error.message.contains("选项"),
        "错误消息应提示选项注入风险：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("选项"), "{}", error.message);
    // 值未被写入本地配置。
    assert_eq!(
        module
            .read_branch_description("main")
            .expect("读取描述")
            .description,
        ""
    );
}

#[test]
fn rejects_description_with_control_characters() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some("第一行\n第二行"),
    );

    let error = module.validate(&request).expect_err("含换行应被拒绝");
    assert!(
        error.message.contains("控制字符"),
        "错误消息应说明控制字符限制：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("控制字符"), "{}", error.message);
}

#[test]
fn rejects_overlong_description() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit(dir, "a.txt", "base\n", "base");
    let module = GitWriteModule::new(dir).expect("打开写模块");
    let overlong = "长".repeat(201);
    let request = request(
        WriteKind::SetBranchDescription,
        None,
        Some("main"),
        Some(&overlong),
    );

    let error = module.validate(&request).expect_err("超长描述应被拒绝");
    assert!(
        error.message.contains("200"),
        "错误消息应包含长度上限：{}",
        error.message
    );
    let error = module.execute(&request).expect_err("执行同样应被拒绝");
    assert!(error.message.contains("200"), "{}", error.message);
}
