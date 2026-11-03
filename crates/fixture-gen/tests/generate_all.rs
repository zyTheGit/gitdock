//! 生成器必须可从半成品目录重跑：缓存恢复或上次中断会留下旧仓库，
//! 而 clone / tag 撞到旧结果会让整个 workspace 测试失败。

#[test]
fn generate_all_can_rerun_over_existing_fixtures() {
    let root = std::env::temp_dir().join(format!("fixture-gen-rerun-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    let first = fixture_gen::generate_all(&root).expect("首次生成夹具");
    assert!(first.linear().join(".git").exists());

    let second = fixture_gen::generate_all(&root).expect("重复生成夹具");
    assert!(second.shallow().join(".git").exists());
    assert!(second.forked().join(".git").exists());

    let _ = std::fs::remove_dir_all(&root);
}
