//! V2 只读查询：六类夹具打开、运行时只读快照与 SHA-256 仓库读写一致性。
//!
//! 覆盖：六类夹具打开与 OID 格式、只读调用不修改仓库、SHA-256 annotated tag /
//! commit 详情 / compare。

mod common;

use std::path::{Path, PathBuf};

use common::*;
use git_core::{
    CompareMode, DiffBaselineDto, FileStatus, GraphScope, HeadKind, ObjectFormat, Oid, RefKind,
};
use test_support::{copy_dir, fixtures, oid_of, read_oid, temp_dir};

/// 断言 OID 长度与仓库对象格式一致，绝不假设固定 40 位。
fn assert_oid_len(oid: &Oid, format: ObjectFormat, what: &str) {
    assert_eq!(
        oid.len(),
        format.hex_len(),
        "{what} 长度必须等于 {}（实际 {}）",
        format.hex_len(),
        oid.len()
    );
    assert!(
        oid.as_str().chars().all(|c| c.is_ascii_hexdigit()),
        "{what} 必须是十六进制"
    );
}

#[test]
fn six_fixture_kinds_open_with_format_aware_oids() {
    let set = fixtures();
    struct Case {
        name: &'static str,
        path: PathBuf,
        format: ObjectFormat,
        bare: bool,
        shallow: bool,
        linked: bool,
    }
    let cases = vec![
        Case {
            name: "linear",
            path: set.linear(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "forked",
            path: set.forked(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "sha256",
            path: set.sha256(),
            format: ObjectFormat::Sha256,
            bare: false,
            shallow: false,
            linked: false,
        },
        Case {
            name: "shallow",
            path: set.shallow(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: true,
            linked: false,
        },
        Case {
            name: "bare",
            path: set.bare(),
            format: ObjectFormat::Sha1,
            bare: true,
            shallow: false,
            linked: false,
        },
        Case {
            name: "worktree-linked",
            path: set.worktree_linked(),
            format: ObjectFormat::Sha1,
            bare: false,
            shallow: false,
            linked: true,
        },
    ];

    for case in cases {
        let read = module(&case.path);
        assert_eq!(read.object_format(), case.format, "{} 对象格式", case.name);
        let state = read
            .state()
            .unwrap_or_else(|e| panic!("{} 读取状态: {e:?}", case.name));
        assert_eq!(state.object_format, case.format, "{}", case.name);
        assert_eq!(state.is_bare, case.bare, "{} is_bare", case.name);
        assert_eq!(state.is_shallow, case.shallow, "{} is_shallow", case.name);
        assert_eq!(
            state.is_linked_worktree, case.linked,
            "{} is_linked_worktree",
            case.name
        );

        // HeadDto：分支名与 OID 必须按对象格式编码。
        assert!(
            matches!(state.head.kind, HeadKind::Branch | HeadKind::Detached),
            "{} HEAD 应有 OID",
            case.name
        );
        let head = state.head.oid.clone().expect("HEAD OID 存在");
        assert_oid_len(&head, case.format, &format!("{} HEAD", case.name));
        if !case.bare {
            assert!(state.head.branch.is_some(), "{} HEAD 应关联分支", case.name);
        }

        // refs 中所有 OID（tag 对象与 peel 后 commit）都需符合格式。
        for reference in &state.refs {
            assert_oid_len(
                &reference.target_oid,
                case.format,
                &format!("{} ref {}", case.name, reference.full_name),
            );
            if let Some(commit) = &reference.commit_oid {
                assert_oid_len(
                    commit,
                    case.format,
                    &format!("{} ref peel {}", case.name, reference.full_name),
                );
            }
        }

        let page = read
            .read_graph_page(&GraphScope::Head, None, 200)
            .unwrap_or_else(|e| panic!("{} 读取图谱: {e:?}", case.name));
        assert!(!page.commits.is_empty(), "{} 图谱不应为空", case.name);
        assert_eq!(
            page.layout.len(),
            page.commits.len(),
            "{} 行数对齐",
            case.name
        );
        for commit in &page.commits {
            assert_oid_len(&commit.oid, case.format, "commit.oid");
            assert!(
                commit.short_oid.chars().all(|c| c.is_ascii_hexdigit()),
                "{} short_oid 必须是十六进制: {}",
                case.name,
                commit.short_oid
            );
            assert_eq!(commit.short_oid.len(), 7, "{} short_oid 长度", case.name);
            assert!(
                commit.oid.as_str().starts_with(&commit.short_oid),
                "{} short_oid 必须是完整 OID 前缀",
                case.name
            );
            for parent in &commit.parents {
                assert_oid_len(parent, case.format, "commit.parent");
            }
        }
        for row in &page.layout {
            assert_oid_len(&row.oid, case.format, "row.oid");
            for lane in row.before_lanes.iter().chain(&row.after_lanes).flatten() {
                assert_oid_len(lane, case.format, "lane 期待 OID");
            }
            for edge in &row.parents {
                assert_oid_len(&edge.parent, case.format, "parent edge OID");
            }
        }
        for edge in &page.resolved_edges {
            assert_oid_len(&edge.parent, case.format, "resolved edge OID");
        }

        // 同一仓库用模块内 HEAD 视图也要可读（bare 也应有 HEAD）。
        assert!(
            page.commits.iter().any(|c| c.oid == head),
            "{} HEAD 视图应包含 HEAD",
            case.name
        );

        println!(
            "FIXTURE {} format={:?} head={} head_len={} branch={:?} bare={} shallow={} linked={} commits={}",
            case.name,
            case.format,
            head,
            head.len(),
            state.head.branch,
            state.is_bare,
            state.is_shallow,
            state.is_linked_worktree,
            page.commits.len()
        );
    }
}

#[test]
fn repository_is_not_mutated_by_reads() {
    let set = fixtures();
    let dir = temp_dir("git-graph-v2-readonly");
    let repo = dir.join("forked");
    copy_dir(&set.forked(), &repo);

    fn snapshot(root: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
        fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64, Option<std::time::SystemTime>)>) {
            for entry in std::fs::read_dir(dir).expect("遍历目录") {
                let entry = entry.expect("目录项");
                let path = entry.path();
                if entry.file_type().expect("类型").is_dir() {
                    walk(&path, out);
                } else {
                    let meta = entry.metadata().expect("元数据");
                    out.push((path, meta.len(), meta.modified().ok()));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, &mut out);
        out.sort();
        out
    }

    let before = snapshot(&repo);
    let read = module(&repo);
    let state = read.state().expect("state");
    let head = state.head.oid.clone().expect("HEAD");
    let _ = read
        .read_graph_page(&GraphScope::All, None, 50)
        .expect("图谱");
    let _ = read.read_commit(&head).expect("commit 详情");
    let _ = read
        .read_file_diff(&head, "main.txt", false)
        .expect("文件 diff");
    let base = oid_of(&read_oid(&repo, "HEAD~2"));
    let _ = read.compare(&base, &head, None, false).expect("compare");
    let after = snapshot(&repo);

    let before_map: std::collections::BTreeMap<PathBuf, (u64, Option<std::time::SystemTime>)> =
        before.into_iter().map(|(p, l, m)| (p, (l, m))).collect();
    let after_map: std::collections::BTreeMap<PathBuf, (u64, Option<std::time::SystemTime>)> =
        after.into_iter().map(|(p, l, m)| (p, (l, m))).collect();
    assert_eq!(
        before_map.keys().collect::<Vec<_>>(),
        after_map.keys().collect::<Vec<_>>(),
        "只读调用不得新增/删除仓库内文件"
    );
    for (path, meta) in &before_map {
        assert_eq!(
            after_map.get(path),
            Some(meta),
            "只读调用修改了 {}",
            path.display()
        );
    }
    println!("READONLY files_unchanged={}", before_map.len());
}

#[test]
fn sha256_tag_detail_and_compare_are_usable() {
    let set = fixtures();
    let repo = set.sha256();
    let read = module(&repo);
    let state = read.state().expect("sha256 state");
    assert_eq!(state.object_format, ObjectFormat::Sha256);

    let head = state.head.oid.clone().expect("HEAD");
    assert_oid_len(&head, ObjectFormat::Sha256, "HEAD");
    assert_eq!(head.len(), 64);

    // annotated tag：直接目标为 tag 对象，peel 后为 commit，两者均 64 位。
    let tag = state
        .refs
        .iter()
        .find(|r| r.full_name == "refs/tags/sha-tag")
        .expect("sha-tag 存在");
    assert_eq!(tag.kind, RefKind::Tag);
    assert_eq!(tag.target_oid.len(), 64);
    assert_ne!(tag.target_oid, tag.commit_oid.clone().expect("tag 可 peel"));
    assert_eq!(
        tag.commit_oid.as_ref().map(Oid::as_str),
        Some(read_oid(&repo, "sha-tag^{commit}").as_str())
    );

    // 图谱：HEAD 与 tag 视图都能读到 2 个提交。
    let page = read
        .read_graph_page(&GraphScope::Head, None, 10)
        .expect("HEAD 图谱");
    assert_eq!(page.commits.len(), 2);
    let tag_page = read
        .read_graph_page(&GraphScope::Branch("sha-tag".to_owned()), None, 10)
        .expect("tag 视图");
    assert_eq!(
        tag_page.commits.len(),
        2,
        "annotated tag 必须可 peel 成 commit 视图"
    );

    // commit 详情。
    let detail = read.read_commit(&head).expect("sha256 commit 详情");
    assert_oid_len(&detail.commit.oid, ObjectFormat::Sha256, "detail oid");
    assert_eq!(detail.baseline, DiffBaselineDto::FirstParent);
    assert_eq!(detail.parents.len(), 1);
    assert_oid_len(&detail.parents[0], ObjectFormat::Sha256, "parent");
    let file = detail
        .files
        .iter()
        .find(|f| f.path == "sha.txt")
        .expect("sha.txt 变更");
    assert_eq!(file.status, FileStatus::Modified);
    assert_eq!((file.additions, file.deletions), (1, 0));
    for changed in &detail.files {
        for oid in [changed.old_oid.as_ref(), changed.new_oid.as_ref()]
            .into_iter()
            .flatten()
        {
            assert_oid_len(oid, ObjectFormat::Sha256, "blob oid");
        }
    }

    let diff = read
        .read_file_diff(&head, "sha.txt", false)
        .expect("sha256 文件 diff");
    assert!(
        diff.patch.as_deref().unwrap_or("").contains("+sha256-2"),
        "patch: {:?}",
        diff.patch
    );

    // compare：HEAD~1...HEAD。
    let parent = oid_of(&read_oid(&repo, "HEAD~1"));
    assert_eq!(parent.len(), 64);
    let result = read
        .compare(&parent, &head, None, false)
        .expect("sha256 compare");
    assert_eq!(result.mode, CompareMode::ThreeDot);
    assert_eq!(
        result.merge_base.as_ref().map(Oid::as_str),
        Some(parent.as_str())
    );
    assert_eq!(result.base_only, 0);
    assert_eq!(result.compare_only, 1);
    assert_eq!(result.commits.len(), 1);
    assert_oid_len(
        &result.commits[0].oid,
        ObjectFormat::Sha256,
        "compare commit",
    );
    assert!(result.files.iter().any(|f| f.path == "sha.txt"));
    assert!(result.warnings.iter().all(|w| w.code != "no_merge_base"));

    let file_diff = read
        .compare_file_diff(&parent, &head, "sha.txt", false, false)
        .expect("sha256 compare 文件");
    assert!(file_diff
        .patch
        .as_deref()
        .unwrap_or("")
        .contains("+sha256-2"));

    println!(
        "SHA256 head={} tag_object={} tag_commit={} commits={} compare_only={}",
        head,
        tag.target_oid,
        tag.commit_oid.as_ref().map(Oid::as_str).unwrap_or("-"),
        page.commits.len(),
        result.compare_only
    );
}
