//! F1-1 性能基线：5 万提交仓库的首屏、翻页与温启动耗时。
//!
//! 默认忽略，需在 release 构建下显式运行：
//! `cargo test -p git-read --release --test perf_baseline -- --ignored --nocapture`
//!
//! 夹具生成一次后缓存到 `target/test-fixtures/perf-50k`；磁盘索引缓存每次运行前清空，
//! 保证“冷启动”数字可复现。

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use git_core::GraphScope;
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
