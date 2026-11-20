//! V2 只读安全静态审计：递归扫描 `crates/git-read/src/` 下全部源码。
//!
//! 审计不依赖固定文件名清单：`src/` 下所有 `.rs`（含未来拆出的子模块）都会被检查，
//! 因此模块拆分（如 `diff.rs` → `diff/`）不会削弱守卫覆盖面。

mod common;

use std::path::Path;

/// 递归收集 `src/` 下全部 Rust 源码，返回（相对路径, 文件内容）。
fn source_files() -> Vec<(String, String)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).expect("遍历源码目录") {
            let entry = entry.expect("目录项");
            let path = entry.path();
            if entry.file_type().expect("文件类型").is_dir() {
                walk(root, &path, out);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                let name = path
                    .strip_prefix(root)
                    .expect("源码相对路径")
                    .to_string_lossy()
                    .replace('\\', "/");
                let text = std::fs::read_to_string(&path).expect("读取源码");
                out.push((name, text));
            }
        }
    }

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));

    // 守卫生效的前提：确实扫到了源码树（含 crate 根模块与缓存写入口）。
    for required in ["lib.rs", "index.rs", "read/mod.rs", "read/probe.rs"] {
        assert!(
            out.iter().any(|(name, _)| name == required),
            "静态审计未覆盖 {required}，扫描路径可能失效: {:?}",
            out.iter().map(|(name, _)| name).collect::<Vec<_>>()
        );
    }
    out
}

fn expect_source<'a>(sources: &'a [(String, String)], name: &str) -> &'a str {
    sources
        .iter()
        .find(|(candidate, _)| candidate == name)
        .map(|(_, source)| source.as_str())
        .unwrap_or_else(|| panic!("缺少源码文件 {name}"))
}

#[test]
fn git_read_source_has_no_write_or_mutation_calls() {
    // 静态审计：只读模块源码不得包含写操作或写型 gix API。
    let sources = source_files();
    assert!(
        sources.len() >= 10,
        "源码条目过少（{}），扫描可能失效",
        sources.len()
    );

    let mut process_calls = 0usize;
    for (name, source) in &sources {
        for forbidden in [
            "reference_mut(",
            "edit_reference",
            "write_tree(",
            "commit_as(",
            "worktree_mut(",
            "tag_mut(",
            "index_mut(",
            "gix::init",
            "gix::clone",
        ] {
            assert!(
                !source.contains(forbidden),
                "{name} 含写型/可变 gix 调用: {forbidden}"
            );
        }
        assert!(
            !source.contains(".args(["),
            "{name} 不得向子进程传参数组（唯一子进程只能是 git --version）"
        );
        assert!(
            !source.contains("\"--force\"") && !source.contains("\"--hard\""),
            "{name} 含破坏性参数"
        );
        process_calls += source.matches("Command::new").count();
    }

    // 唯一允许的子进程探测：`git --version`（只读版本查询）。子进程执行统一收在
    // git-core 的 process（构造底座 + recorder 执行 seam），探测必须经由 run_git_output。
    assert_eq!(process_calls, 0, "只读模块不得直接构造子进程");
    let process_module = include_str!("../../git-core/src/process/mod.rs");
    assert!(
        process_module.contains("Command::new(\"git\")"),
        "共用子进程构造必须是 git"
    );
    let read_source = expect_source(&sources, "read/probe.rs");
    let detect_start = read_source
        .find("fn detect_git_version")
        .expect("detect_git_version 存在");
    let detect_end = detect_start
        + read_source[detect_start..]
            .find("fn version_at_least")
            .unwrap();
    let detect = &read_source[detect_start..detect_end];
    assert!(
        detect.contains("run_git_output"),
        "子进程必须走统一执行 seam"
    );
    assert!(
        !detect.contains("git_command()"),
        "探测不得绕过执行 seam 自行构造"
    );
    assert!(
        detect.contains("\"--version\""),
        "子进程参数只能是 --version"
    );
    for write_word in [
        "commit",
        "update-ref",
        "push",
        "reset",
        "checkout",
        "switch",
        "merge",
        "cherry-pick",
        "revert",
        "gc",
        "repack",
        "worktree",
        "fetch",
    ] {
        assert!(
            !detect.contains(write_word),
            "版本探测子进程不得包含写型子命令: {write_word}"
        );
    }

    // 缓存写入只允许发生在 index.rs 的应用缓存目录中，且不写仓库。
    let index_source = expect_source(&sources, "index.rs");
    assert_eq!(
        index_source.matches("std::fs::write").count(),
        1,
        "缓存写入口应唯一"
    );
    assert!(index_source.contains("fn write_cache"), "缓存写入口明确");
    assert!(
        index_source.contains("cache_file_path"),
        "缓存路径来自 cache_dir"
    );
    assert!(index_source.contains("dir.join("), "缓存文件写入缓存目录");
    for (name, source) in &sources {
        if name == "index.rs" {
            // 缓存写入口是唯一例外，上面已单独审计。
            continue;
        }
        assert!(
            !source.contains("std::fs::write") && !source.contains("std::fs::remove"),
            "{name} 不得写文件"
        );
    }
    println!(
        "SOURCE AUDIT files={} process_calls={process_calls} mutation_calls=0",
        sources.len()
    );
}
