//! 搜索作者日期区间与分页边界。

mod common;

use common::*;
use git_core::{ErrorCode, GraphScope, SearchDateRange, SearchRequest};
use test_support::{commit, current_head, git_ok, init_temp_repo, write};

fn request(id: &str, date_range: Option<SearchDateRange>) -> SearchRequest {
    SearchRequest {
        search_id: id.to_owned(),
        scope: GraphScope::All,
        text: "needle".to_owned(),
        highlight: "needle".to_owned(),
        date_range,
    }
}

fn commit_at(
    dir: &std::path::Path,
    name: &str,
    content: &str,
    message: &str,
    date: &str,
) -> String {
    write(&dir.join(name), content);
    git_ok(dir, &["add", "-A"]);
    git_ok(dir, &["commit", "--date", date, "-m", message]);
    current_head(dir)
}

#[test]
fn search_filters_by_authored_date_not_commit_date() {
    let temp = init_temp_repo();
    let dir = temp.path();
    commit_at(
        dir,
        "a.txt",
        "old\n",
        "needle old",
        "2020-01-02T12:00:00+00:00",
    );
    commit_at(
        dir,
        "a.txt",
        "recent\n",
        "needle recent",
        "2026-11-26T12:00:00+00:00",
    );
    let read = module(dir);

    let all = read
        .search(&request("all", None), None)
        .expect("无日期筛选");
    assert_eq!(all.results.len(), 2);

    let old_day = read
        .search(
            &request(
                "old-day",
                Some(SearchDateRange {
                    from: Some(1_577_923_200),
                    to: Some(1_578_009_600),
                }),
            ),
            None,
        )
        .expect("作者日期范围");
    assert_eq!(old_day.results.len(), 1);
    assert_eq!(old_day.results[0].commit.authored_at, 1_577_966_400);
    assert!(old_day.results[0].commit.committed_at > old_day.results[0].commit.authored_at);

    let from_only = read
        .search(
            &request(
                "from-only",
                Some(SearchDateRange {
                    from: Some(1_578_009_600),
                    to: None,
                }),
            ),
            None,
        )
        .expect("仅限制起点");
    assert_eq!(from_only.results.len(), 1);
    assert_eq!(from_only.results[0].commit.authored_at, 1_795_694_400);

    let to_only = read
        .search(
            &request(
                "to-only",
                Some(SearchDateRange {
                    from: None,
                    to: Some(1_577_923_200),
                }),
            ),
            None,
        )
        .expect("仅限制终点");
    assert!(to_only.results.is_empty());

    let future = read
        .search(
            &request(
                "future",
                Some(SearchDateRange {
                    from: Some(4_102_444_800),
                    to: Some(4_102_531_200),
                }),
            ),
            None,
        )
        .expect("未来日期");
    assert!(future.results.is_empty());
}

#[test]
fn invalid_date_range_is_rejected_before_empty_query() {
    let temp = init_temp_repo();
    let read = module(temp.path());
    let mut invalid = request(
        "invalid",
        Some(SearchDateRange {
            from: Some(20),
            to: Some(10),
        }),
    );
    invalid.text = "   ".to_owned();

    let err = read.search(&invalid, None).expect_err("无效区间应报错");
    assert_eq!(err.code, ErrorCode::InvalidArgument);
    assert_eq!(err.key.as_deref(), Some("errors.searchDateRangeInvalid"));
}

#[test]
fn full_search_page_cursor_does_not_skip_next_commit() {
    let temp = init_temp_repo();
    let dir = temp.path();
    for index in 0..201 {
        commit(
            dir,
            "a.txt",
            &format!("{index}\n"),
            &format!("needle {index}"),
        );
    }
    let read = module(dir);
    let query = request("pagination", None);

    let first = read.search(&query, None).expect("第一页");
    assert_eq!(first.results.len(), 200);
    assert!(first.has_more);
    let cursor = first.next_cursor.expect("满页应有游标");

    let second = read.search(&query, Some(&cursor)).expect("第二页");
    assert_eq!(second.results.len(), 1);
    assert!(!second.has_more);
    assert_ne!(
        first.results.last().expect("第一页末条").commit.oid,
        second.results[0].commit.oid
    );
}
