//! 本地分支上游与 ahead/behind 计数（ADR-0028）。
//!
//! 纯 gix、只读：从 local config 读 `branch.<name>.remote` + `branch.<name>.merge`，
//! 解析出上游引用，再用 merge-base + 有界 rev walk 数出两侧提交数。
//!
//! 边界：
//! - 只处理本地分支，且只处理配置了完整上游（remote + merge 均存在）的分支；
//! - 单侧提交数上限 [`MAX_UPSTREAM_COMMITS`]，超出即返回 None，绝不返回错误数字；
//! - 需要计数的分支数上限 [`MAX_UPSTREAM_BRANCHES`]，超出时只保留上游名、不给计数；
//! - 任何单分支错误都降级为 None，不会让 `open_repository` 失败或阻塞。

use std::collections::HashMap;

use crate::util::lossy;

/// 单侧（ahead 或 behind）提交扫描上限；超过即放弃该侧计数。
pub(crate) const MAX_UPSTREAM_COMMITS: u32 = 500;

/// 需要做 merge-base 计算的分支数上限；保护分支极多的仓库打开耗时。
pub(crate) const MAX_UPSTREAM_BRANCHES: usize = 200;

/// 单个本地分支的上游状态；缺省（None）表示不展示。
#[derive(Debug, Clone, Default)]
pub(crate) struct UpstreamState {
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: Option<u32>,
    pub(crate) behind: Option<u32>,
}

/// 配置中的上游：`display` 为界面展示名（`origin/main`），`full_ref` 为本地解析用完整引用名。
struct ConfiguredUpstream {
    display: String,
    full_ref: String,
}

/// 读取全部本地分支的上游状态；按分支短名索引。
pub(crate) fn read_upstream_states(repo: &gix::Repository) -> HashMap<String, UpstreamState> {
    let configured = configured_upstreams(repo);
    let mut states = HashMap::with_capacity(configured.len());
    let mut counted = 0usize;
    for (branch, upstream) in configured {
        let mut state = UpstreamState {
            upstream: Some(upstream.display.clone()),
            ..Default::default()
        };
        if counted < MAX_UPSTREAM_BRANCHES {
            counted += 1;
            if let Some((ahead, behind)) = count_ahead_behind(repo, &branch, &upstream.full_ref) {
                state.ahead = ahead;
                state.behind = behind;
            }
        }
        states.insert(branch, state);
    }
    states
}

/// 从 local config 收集 `branch.<name>.remote` + `branch.<name>.merge` 配对完整的分支。
fn configured_upstreams(repo: &gix::Repository) -> Vec<(String, ConfiguredUpstream)> {
    let snapshot = repo.config_snapshot();
    let Some(sections) = snapshot.plumbing().sections_by_name("branch") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for section in sections {
        let Some(name) = section.header().subsection_name() else {
            continue;
        };
        let branch = lossy(AsRef::<[u8]>::as_ref(name));
        let (Some(remote), Some(merge)) = (section.value("remote"), section.value("merge")) else {
            continue;
        };
        let remote = lossy(remote.as_ref());
        let merge = lossy(merge.as_ref());
        // 上游必须是分支（refs/heads/...）；tag / 裸 OID 上游没有 ahead/behind 语义。
        let Some(merge_short) = merge.strip_prefix("refs/heads/") else {
            continue;
        };
        if remote.is_empty() || merge_short.is_empty() {
            continue;
        }
        let (display, full_ref) = if remote == "." {
            // 本地跟踪（remote 为 `.`）：上游就是本地同名分支。
            (merge_short.to_owned(), merge.clone())
        } else {
            (
                format!("{remote}/{merge_short}"),
                format!("refs/remotes/{remote}/{merge_short}"),
            )
        };
        out.push((branch, ConfiguredUpstream { display, full_ref }));
    }
    out
}

/// 计算本地分支与上游的 ahead/behind；任一侧无法可靠计算时该侧为 None。
fn count_ahead_behind(
    repo: &gix::Repository,
    branch: &str,
    upstream_ref: &str,
) -> Option<(Option<u32>, Option<u32>)> {
    let local = ref_commit(repo, &format!("refs/heads/{branch}"))?;
    let remote = ref_commit(repo, upstream_ref)?;
    // 无 merge-base（无关历史、浅克隆边界）时不猜数字：两侧均返回 None。
    let base = repo.merge_base(local, remote).ok()??.detach();
    Some((
        count_side(repo, local, base),
        count_side(repo, remote, base),
    ))
}

/// 引用直接指向（peel 后）的 commit OID；引用不存在或不可 peel 时 None。
fn ref_commit(repo: &gix::Repository, name: &str) -> Option<gix::hash::ObjectId> {
    repo.find_reference(name)
        .ok()?
        .into_fully_peeled_id()
        .ok()
        .map(|id| id.detach())
}

/// 统计 `base..tip` 的提交数（等价 `git rev-list --count base..tip`）。
///
/// `with_hidden` 只在两侧历史分叉处停止，正常分支通常只走实际领先的提交；
/// 一旦超过上限即返回 None，宁可少显示徽章也不抖动 `open_repository`。
fn count_side(
    repo: &gix::Repository,
    tip: gix::hash::ObjectId,
    base: gix::hash::ObjectId,
) -> Option<u32> {
    let walk = repo.rev_walk([tip]).with_hidden([base]).all().ok()?;
    let mut count = 0u32;
    for info in walk {
        info.ok()?;
        count += 1;
        if count > MAX_UPSTREAM_COMMITS {
            return None;
        }
    }
    Some(count)
}
