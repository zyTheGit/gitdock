//! diff 模块单元测试：树级精简匹配与完整变更清单的语义一致性。

use super::tree_changes::RawChange;
use super::{changed_path_matching, collect_changes};

/// 精简匹配只做树级剪枝，语义必须与 `collect_changes` 的文件清单一致：
/// 同样取“第一个路径包含关键字”的文件，大小写不敏感。
#[test]
fn changed_path_matching_agrees_with_collect_changes() {
    let path = test_support::fixtures().forked();
    let repo = gix::open(path).expect("打开夹具仓库");
    let head = crate::util::oid_from_id(&repo.head_id().expect("HEAD"));
    let index = crate::index::build(&repo, &[head], "test", 0, None).expect("索引");
    let needles = ["feature.txt", "txt", "src", "src ", ".", "zzz", "README"];
    let mut compared = 0usize;
    for oid in &index.order {
        let commit = crate::util::find_commit(&repo, oid).expect("提交");
        let old_tree = commit.parent_ids().next().map(|parent| {
            crate::read::tree_oid_of_commit(&repo, &crate::util::oid_from_id(&parent))
                .expect("父树")
        });
        let new_tree = Some(crate::util::oid_from_id(&commit.tree_id().expect("提交树")));
        for needle in needles {
            let expected = collect_changes(&repo, old_tree.as_ref(), new_tree.as_ref(), None)
                .expect("完整 diff")
                .files
                .iter()
                .map(RawChange::path)
                .map(str::to_owned)
                .find(|file| file.to_lowercase().contains(needle));
            let actual = changed_path_matching(&repo, old_tree.as_ref(), new_tree.as_ref(), needle)
                .expect("精简匹配");
            assert_eq!(actual, expected, "oid={} needle={needle}", oid.short(8));
            compared += 1;
        }
    }
    assert!(compared > 0);
}
