//! V2 性能基线：200 行首页耗时与索引缓存命中。

mod common;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use git_core::GraphScope;
use git_read::GitReadModule;
use test_support::{git_ok, temp_dir};

fn median_ms(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

fn build_linear_repo(dir: &Path, commits: usize) {
    std::fs::create_dir_all(dir).expect("创建性能仓库目录");
    git_ok(dir, &["init", "-q", "-b", "main"]);
    let mut stream = String::new();
    for i in 0..commits {
        let timestamp = 1_700_000_000 + i as i64;
        let msg = format!("perf commit {i}");
        let content = format!("commit {i}\n");
        stream.push_str("commit refs/heads/main\n");
        stream.push_str(&format!(
            "committer Perf <perf@example.com> {timestamp} +0000\n"
        ));
        stream.push_str(&format!("data {}\n{}\n", msg.len(), msg));
        stream.push_str("M 644 inline file.txt\n");
        stream.push_str(&format!("data {}\n{}", content.len(), content));
        stream.push('\n');
    }
    let mut child = Command::new("git")
        .current_dir(dir)
        .args(["fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("启动 fast-import");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(stream.as_bytes())
        .expect("写入 fast-import 流");
    let status = child.wait().expect("等待 fast-import");
    assert!(status.success(), "fast-import 失败");
}

fn timed_open_and_first_page(path: &Path, cache: Option<PathBuf>) -> (f64, usize, bool) {
    let start = Instant::now();
    let read = GitReadModule::open(path, cache).expect("打开仓库");
    let page = read
        .read_graph_page(&GraphScope::Head, None, 200)
        .expect("首页 200 行");
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    (elapsed, page.commits.len(), page.has_more)
}

#[test]
fn perf_200_row_first_page_and_cached_index() {
    let dir = temp_dir("git-graph-v2-perf");
    let repo = dir.join("perf");
    build_linear_repo(&repo, 200);

    // 冷读：不带缓存目录，每次都重新遍历 + 拓扑排序。
    let mut cold = Vec::new();
    let mut rows = 0;
    for _ in 0..3 {
        let (ms, count, has_more) = timed_open_and_first_page(&repo, None);
        rows = count;
        assert_eq!(count, 200, "首页应返回 200 行");
        assert!(!has_more, "200 行即全部历史");
        cold.push(ms);
    }
    let cold_median = median_ms(cold.clone());

    // 缓存命中：先预热一次写入索引缓存，再用同一缓存目录重复打开 + 首页。
    let cache = dir.join("cache");
    let _ = timed_open_and_first_page(&repo, Some(cache.clone()));
    let mut cached = Vec::new();
    for _ in 0..3 {
        let (ms, count, _) = timed_open_and_first_page(&repo, Some(cache.clone()));
        assert_eq!(count, 200);
        cached.push(ms);
    }
    let cached_median = median_ms(cached.clone());

    // 以宽松上限防止 CI 抖动误报，同时真实数值打印到报告。
    assert!(
        cold_median < 5000.0,
        "冷读首页中位数过高: {cold_median:.2}ms"
    );
    assert!(
        cached_median < 2000.0,
        "缓存命中首页耗时应低于 2s: {cached_median:.2}ms"
    );

    println!(
        "PERF rows={rows} cold_ms={:?} cold_median={cold_median:.2} cached_ms={:?} cached_median={cached_median:.2}",
        cold.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>(),
        cached.iter().map(|v| (v * 100.0).round() / 100.0).collect::<Vec<_>>()
    );
}
