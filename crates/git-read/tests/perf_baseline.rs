//! F1-1 性能基线：5 万提交仓库的首屏、翻页与温启动耗时。
//!
//! 默认忽略，需在 release 构建下显式运行：
//! `cargo test -p git-read --release --test perf_baseline -- --ignored --nocapture`
//!
//! 夹具生成一次后缓存到 `target/test-fixtures/perf-50k`；磁盘索引缓存每次运行前清空，
//! 保证“冷启动”数字可复现。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use git_core::{GraphScope, Oid};
use git_read::GitReadModule;

const COMMITS: usize = 50_000;
const PAGE_LIMIT: usize = 200;
const FIRST_SCREEN_BUDGET: Duration = Duration::from_millis(1500);

struct Stage {
    repo: PathBuf,
    cache: PathBuf,
}

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

fn stage() -> Stage {
    let root = test_support::fixture_root().join("perf-50k");
    let marker = root.join(".perf-ok");
    if !marker.exists() {
        fixture_gen::generate_perf(&root, COMMITS).expect("生成 5 万提交性能仓库");
        std::fs::write(&marker, COMMITS.to_string()).expect("写入性能夹具标记");
    }
    let cache = root.join("cache");
    if cache.exists() {
        std::fs::remove_dir_all(&cache).expect("清空索引缓存");
    }
    std::fs::create_dir_all(&cache).expect("创建索引缓存目录");
    Stage {
        repo: root.join("perf"),
        cache,
    }
}

fn open(repo: &Path, cache: &Path) -> GitReadModule {
    GitReadModule::open(repo, Some(cache.to_path_buf())).expect("打开性能仓库")
}

#[test]
#[ignore = "性能基线：需 release 构建显式运行，见文件头注释"]
fn five_myriad_commits_first_screen_within_budget() {
    let stage = stage();

    let begin = Instant::now();
    let read = open(&stage.repo, &stage.cache);
    let open_time = begin.elapsed();

    let begin = Instant::now();
    let state = read.state().expect("读取仓库状态");
    let state_time = begin.elapsed();
    assert_eq!(state.head.branch.as_deref(), Some("main"));

    let begin = Instant::now();
    let first = read
        .read_graph_page(&GraphScope::Head, None, PAGE_LIMIT)
        .expect("读取首屏");
    let first_page = begin.elapsed();
    let first_screen = open_time + state_time + first_page;

    assert_eq!(first.commits.len(), PAGE_LIMIT, "首屏每页 200 条");
    assert_eq!(first.layout.len(), PAGE_LIMIT, "布局行与提交一一对应");
    assert!(first.has_more, "5 万提交应有下一页");
    assert!(
        first.layout.iter().all(|row| row.lane_count == 1),
        "线性历史应只有一条 lane"
    );

    let begin = Instant::now();
    let repeated = read
        .read_graph_page(&GraphScope::Head, None, PAGE_LIMIT)
        .expect("重复读取首屏");
    let repeated_page = begin.elapsed();
    assert_eq!(repeated.commits[0].oid, first.commits[0].oid);
    assert_eq!(repeated.generation, first.generation);

    let mut cursor = first.next_cursor.clone();
    let mut page_times = Vec::new();
    let mut seen = first
        .commits
        .iter()
        .map(|commit| commit.oid.clone())
        .collect::<Vec<_>>();
    for _ in 0..2 {
        let cursor_token = cursor.expect("应有下一页游标");
        let begin = Instant::now();
        let page = read
            .read_graph_page(&GraphScope::Head, Some(&cursor_token), PAGE_LIMIT)
            .expect("读取后续页");
        page_times.push(begin.elapsed());
        assert_eq!(page.commits.len(), PAGE_LIMIT);
        assert!(
            page.commits
                .iter()
                .all(|commit| !seen.contains(&commit.oid)),
            "翻页结果不应与已渲染提交重叠"
        );
        seen.extend(page.commits.iter().map(|commit| commit.oid.clone()));
        cursor = page.next_cursor.clone();
    }
    assert_eq!(seen.len(), PAGE_LIMIT * 3);

    let warm = open(&stage.repo, &stage.cache);
    let begin = Instant::now();
    let warm_first = warm
        .read_graph_page(&GraphScope::Head, None, PAGE_LIMIT)
        .expect("温启动读取首屏");
    let warm_page = begin.elapsed();
    assert_eq!(warm_first.commits[0].oid, first.commits[0].oid);

    println!("\nF1-1 性能基线（{COMMITS} 提交，release）");
    println!("打开仓库          {:>9.1} ms", ms(open_time));
    println!("读取状态          {:>9.1} ms", ms(state_time));
    println!("首屏第一页        {:>9.1} ms", ms(first_page));
    println!(
        "首屏合计          {:>9.1} ms（预算 {} ms）",
        ms(first_screen),
        FIRST_SCREEN_BUDGET.as_millis()
    );
    println!("同一实例重复首屏  {:>9.1} ms", ms(repeated_page));
    for (index, time) in page_times.iter().enumerate() {
        println!("第 {} 页           {:>9.1} ms", index + 2, ms(*time));
    }
    println!("温启动首屏        {:>9.1} ms", ms(warm_page));

    assert!(
        first_screen <= FIRST_SCREEN_BUDGET,
        "首屏（打开 + 状态 + 第一页）耗时 {:.1} ms，超出 {} ms 预算",
        ms(first_screen),
        FIRST_SCREEN_BUDGET.as_millis()
    );
}

fn generate_multi_branch_fixture(root: &Path) -> PathBuf {
    let repo = root.join("multi");
    let marker = root.join(".perf-multi-ok");
    if !marker.exists() {
        if repo.exists() {
            let _ = std::fs::remove_dir_all(&repo);
        }
        std::fs::create_dir_all(&repo).expect("创建多分支夹具目录");
        test_support::init_repo(&repo);
        let mut child = Command::new("git")
            .current_dir(&repo)
            .args(["fast-import", "--quiet"])
            .stdin(Stdio::piped())
            .spawn()
            .expect("启动 git fast-import");
        {
            let stdin = child.stdin.as_mut().expect("写入 fast-import stdin");
            let mut mark = 1usize;
            let mut ts = 1_700_000_000usize;
            for i in 0..200usize {
                let data = format!("main line {i}\n");
                writeln!(stdin, "commit refs/heads/main").unwrap();
                writeln!(stdin, "mark :{mark}").unwrap();
                writeln!(stdin, "committer Perf Bot <perf@example.com> {ts} +0000").unwrap();
                let msg = format!("main commit {i}");
                writeln!(stdin, "data {}\n{msg}", msg.len()).unwrap();
                if i > 0 {
                    writeln!(stdin, "from :{}", mark - 1).unwrap();
                }
                writeln!(stdin, "M 100644 inline main.txt").unwrap();
                writeln!(stdin, "data {}\n{data}", data.len()).unwrap();
                mark += 1;
                ts += 60;
            }
            let mut last_main_mark = mark - 1;
            for branch_idx in 0..30usize {
                let branch_ref = format!("refs/heads/feat-{branch_idx:02}");
                let base_mark = 40 + branch_idx * 4;
                let mut parent_mark = base_mark;
                for step in 0..160usize {
                    let data = format!("branch {branch_idx} step {step}\n");
                    writeln!(stdin, "commit {branch_ref}").unwrap();
                    writeln!(stdin, "mark :{mark}").unwrap();
                    writeln!(stdin, "committer Perf Bot <perf@example.com> {ts} +0000").unwrap();
                    let msg = format!("feat-{branch_idx:02} commit {step}");
                    writeln!(stdin, "data {}\n{msg}", msg.len()).unwrap();
                    writeln!(stdin, "from :{parent_mark}").unwrap();
                    writeln!(stdin, "M 100644 inline branch_{branch_idx:02}.txt").unwrap();
                    writeln!(stdin, "data {}\n{data}", data.len()).unwrap();
                    parent_mark = mark;
                    mark += 1;
                    ts += 60;
                }
                if branch_idx % 3 == 0 {
                    writeln!(stdin, "commit refs/heads/main").unwrap();
                    writeln!(stdin, "mark :{mark}").unwrap();
                    writeln!(stdin, "committer Perf Bot <perf@example.com> {ts} +0000").unwrap();
                    let msg = format!("Merge feat-{branch_idx:02} into main");
                    writeln!(stdin, "data {}\n{msg}", msg.len()).unwrap();
                    writeln!(stdin, "from :{last_main_mark}").unwrap();
                    writeln!(stdin, "merge :{parent_mark}").unwrap();
                    last_main_mark = mark;
                    mark += 1;
                    ts += 60;
                }
            }
        }
        let status = child.wait().expect("等待 git fast-import");
        assert!(status.success(), "git fast-import 失败: {status}");
        test_support::git_ok(&repo, &["checkout", "-q", "-f", "main"]);
        std::fs::write(&marker, "5010").expect("写入多分支夹具标记");
    }
    repo
}

#[test]
#[ignore = "性能基线：需 release 构建显式运行，见文件头注释"]
fn multi_branch_commits_first_screen_within_budget() {
    let root = test_support::fixture_root().join("perf-multi-branch");
    let repo = generate_multi_branch_fixture(&root);
    let cache = root.join("cache");
    if cache.exists() {
        std::fs::remove_dir_all(&cache).expect("清空多分支索引缓存");
    }
    std::fs::create_dir_all(&cache).expect("创建多分支索引缓存");

    let begin = Instant::now();
    let read = open(&repo, &cache);
    let open_time = begin.elapsed();

    let begin = Instant::now();
    let state = read.state().expect("读取多分支仓库状态");
    let state_time = begin.elapsed();
    assert!(state.refs.len() >= 31, "应至少包含 30 条分支与 main");

    let begin = Instant::now();
    let first = read
        .read_graph_page(&GraphScope::All, None, PAGE_LIMIT)
        .expect("读取多分支首屏");
    let first_page = begin.elapsed();
    let first_screen = open_time + state_time + first_page;
    assert_eq!(first.commits.len(), PAGE_LIMIT);
    let max_lanes = first
        .layout
        .iter()
        .map(|row| row.lane_count)
        .max()
        .unwrap_or(0);
    assert!(max_lanes > 1, "多分支合并拓扑应存在多条并行泳道");

    let next_cursor = first.next_cursor.expect("多分支仓库应有下一页");
    let begin = Instant::now();
    let second = read
        .read_graph_page(&GraphScope::All, Some(&next_cursor), PAGE_LIMIT)
        .expect("读取多分支第 2 页");
    let second_page = begin.elapsed();
    assert_eq!(second.commits.len(), PAGE_LIMIT);

    let find_branch_oid = |name: &str| -> Oid {
        state
            .refs
            .iter()
            .find(|r| r.short_name == name)
            .and_then(|r| r.commit_oid.clone())
            .expect("分支应有提交 OID")
    };
    let branch_a = find_branch_oid("feat-01");
    let branch_b = find_branch_oid("feat-02");
    let begin = Instant::now();
    let cmp = read
        .compare(&branch_a, &branch_b, None, false)
        .expect("分叉分支三点对比");
    let compare_time = begin.elapsed();
    assert_eq!(cmp.base_only, 160);
    assert_eq!(cmp.compare_only, 164);

    println!("\nF1-1 多分支性能基线（30 分支 + 合并 / ~5010 提交，release）");
    println!("打开仓库          {:>9.1} ms", ms(open_time));
    println!("读取状态          {:>9.1} ms", ms(state_time));
    println!(
        "全量首屏第一页    {:>9.1} ms (max_lanes={max_lanes})",
        ms(first_page)
    );
    println!(
        "首屏合计          {:>9.1} ms（预算 {} ms）",
        ms(first_screen),
        FIRST_SCREEN_BUDGET.as_millis()
    );
    println!("第 2 页           {:>9.1} ms", ms(second_page));
    println!("分叉三点对比      {:>9.1} ms", ms(compare_time));

    assert!(
        first_screen <= FIRST_SCREEN_BUDGET,
        "多分支首屏耗时 {:.1} ms，超出 {} ms 预算",
        ms(first_screen),
        FIRST_SCREEN_BUDGET.as_millis()
    );
}
