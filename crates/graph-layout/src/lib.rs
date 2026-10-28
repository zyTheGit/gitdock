//! 自研 Git DAG 布局。
//!
//! 纯状态机：不访问文件系统、不执行 Git、不依赖 UI。所有不变量都可以用合成 DAG 验证。
//!
//! 不变量：
//! 1. 同一 view_key 生命周期内，已输出提交的 lane 永不改变。
//! 2. 父提交尚未出现时，其边处于 pending 状态；父提交进入布局后，旧行收到 resolved 通知。
//! 3. lane 只在所期待的提交被处理后释放，避免跨页复用造成连线穿越。

use std::collections::{HashMap, HashSet};

use git_core::{Oid, ParentEdgeDto, RowLayoutDto};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutCommit {
    pub oid: Oid,
    pub parents: Vec<Oid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEdge {
    pub row: usize,
    pub parent: Oid,
    pub lane: usize,
}

#[derive(Debug, Clone)]
pub struct LayoutDelta {
    pub view_key: String,
    pub rows: Vec<RowLayoutDto>,
    pub resolved: Vec<ResolvedEdge>,
    /// 当前布局的最大 lane 数，前端据此确定画布宽度。
    pub lane_count: usize,
}

#[derive(Debug, Default)]
pub struct GraphLayoutModule {
    view_key: Option<String>,
    lanes: Vec<Option<Oid>>,
    rows: Vec<RowLayoutDto>,
    rendered: HashSet<Oid>,
    /// parent OID -> 指向它的 pending 边所在行。
    pending: HashMap<Oid, Vec<usize>>,
    max_lane_count: usize,
}

impl GraphLayoutModule {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn view_key(&self) -> Option<&str> {
        self.view_key.as_deref()
    }

    /// 为新的视图生命周期建立独立状态。旧 lane 分配全部丢弃。
    pub fn reset(&mut self, view_key: &str) {
        self.view_key = Some(view_key.to_owned());
        self.lanes.clear();
        self.rows.clear();
        self.rendered.clear();
        self.pending.clear();
        self.max_lane_count = 0;
    }

    /// 追加一页拓扑序提交，返回可直接渲染的增量。
    ///
    /// 调用方必须保证页内与跨页提交不重复；重复提交会被忽略（不产生行），
    /// 这是对上层分页缺陷的防御，而不是公开语义。
    pub fn append(&mut self, page: &[LayoutCommit]) -> LayoutDelta {
        let view_key = self.view_key.clone().unwrap_or_default();
        let rows_base = self.rows.len();
        let mut rows: Vec<RowLayoutDto> = Vec::with_capacity(page.len());
        let mut resolved = Vec::new();

        for commit in page {
            if self.rendered.contains(&commit.oid) {
                continue;
            }
            let before = self.lanes.clone();
            let mut free_reserved: HashSet<usize> = HashSet::new();

            let matching: Vec<usize> = self
                .lanes
                .iter()
                .enumerate()
                .filter(|(_, expected)| expected.as_ref() == Some(&commit.oid))
                .map(|(lane, _)| lane)
                .collect();

            let node_lane;
            let mut converging = Vec::new();
            if let Some(first) = matching.first().copied() {
                node_lane = first;
                for lane in matching.iter().skip(1) {
                    converging.push(*lane);
                    free_reserved.insert(*lane);
                    self.lanes[*lane] = None;
                }
            } else {
                node_lane = self.allocate(&free_reserved);
                if self.lanes.len() <= node_lane {
                    self.lanes.push(None);
                }
                // 占位，避免在分配额外父 lane 时复用自身。
                self.lanes[node_lane] = Some(commit.oid.clone());
            }

            let mut edges = Vec::with_capacity(commit.parents.len());
            match commit.parents.split_first() {
                None => {
                    self.lanes[node_lane] = None;
                }
                Some((first_parent, rest)) => {
                    self.lanes[node_lane] = Some(first_parent.clone());
                    edges.push(ParentEdgeDto {
                        parent: first_parent.clone(),
                        lane: node_lane,
                        pending: !self.rendered.contains(first_parent),
                    });
                    for parent in rest {
                        let existing = self
                            .lanes
                            .iter()
                            .position(|expected| expected.as_ref() == Some(parent))
                            .filter(|lane| *lane != node_lane);
                        let lane = match existing {
                            Some(lane) => lane,
                            None => {
                                let lane = self.allocate(&free_reserved);
                                if self.lanes.len() <= lane {
                                    self.lanes.push(None);
                                }
                                self.lanes[lane] = Some(parent.clone());
                                lane
                            }
                        };
                        edges.push(ParentEdgeDto {
                            parent: parent.clone(),
                            lane,
                            pending: !self.rendered.contains(parent),
                        });
                    }
                }
            }

            let after = self.lanes.clone();
            let lane_count = self.lane_count_for(&before, &after, node_lane, &edges);
            self.max_lane_count = self.max_lane_count.max(lane_count);

            let row = RowLayoutDto {
                oid: commit.oid.clone(),
                lane: node_lane,
                converging_lanes: converging,
                parents: edges.clone(),
                before_lanes: trim_lanes(before, lane_count),
                after_lanes: trim_lanes(after, lane_count),
                lane_count,
            };
            let row_index = self.rows.len();
            for edge in &edges {
                if edge.pending {
                    self.pending
                        .entry(edge.parent.clone())
                        .or_default()
                        .push(row_index);
                }
            }

            if let Some(rows_awaiting) = self.pending.remove(&commit.oid) {
                for row in rows_awaiting {
                    if let Some(stored) = self.rows.get_mut(row) {
                        if let Some(edge) = stored
                            .parents
                            .iter_mut()
                            .find(|edge| edge.parent == commit.oid)
                        {
                            edge.pending = false;
                            let lane = edge.lane;
                            let row_oid = stored.oid.clone();
                            if row < rows_base {
                                // 之前页面的行需要 resolved 通知来更新已渲染的边。
                                resolved.push(ResolvedEdge {
                                    row,
                                    parent: commit.oid.clone(),
                                    lane,
                                });
                            } else if let Some(local) =
                                rows.iter_mut().find(|local| local.oid == row_oid)
                            {
                                // 同页行尚未交付给前端，直接返回最终状态。
                                if let Some(local_edge) = local
                                    .parents
                                    .iter_mut()
                                    .find(|edge| edge.parent == commit.oid)
                                {
                                    local_edge.pending = false;
                                }
                            }
                        }
                    }
                }
            }

            self.rows.push(row.clone());
            self.rendered.insert(commit.oid.clone());
            rows.push(row);
        }

        LayoutDelta {
            view_key,
            rows,
            resolved,
            lane_count: self.max_lane_count,
        }
    }

    /// 已渲染行快照，仅用于测试/诊断，不参与运行时数据流。
    #[doc(hidden)]
    pub fn rows(&self) -> &[RowLayoutDto] {
        &self.rows
    }

    fn allocate(&self, reserved: &HashSet<usize>) -> usize {
        self.lanes
            .iter()
            .enumerate()
            .find(|(lane, expected)| expected.is_none() && !reserved.contains(lane))
            .map(|(lane, _)| lane)
            .unwrap_or_else(|| {
                // 找到第一个未被本行保留的空闲 lane；若都被保留则追加。
                self.lanes.len()
            })
    }

    fn lane_count_for(
        &self,
        before: &[Option<Oid>],
        after: &[Option<Oid>],
        node_lane: usize,
        edges: &[ParentEdgeDto],
    ) -> usize {
        let mut count = node_lane + 1;
        // before 与 after 必须各自从 0 开始编号；chain 后 enumerate 会错位。
        for lanes in [before, after] {
            for (lane, expected) in lanes.iter().enumerate() {
                if expected.is_some() {
                    count = count.max(lane + 1);
                }
            }
        }
        for edge in edges {
            count = count.max(edge.lane + 1);
        }
        count.max(1)
    }
}

fn trim_lanes(lanes: Vec<Option<Oid>>, lane_count: usize) -> Vec<Option<Oid>> {
    let mut lanes = lanes;
    lanes.truncate(lane_count);
    while lanes.len() < lane_count {
        lanes.push(None);
    }
    lanes
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn oid(n: u64) -> Oid {
        let hex = format!("{n:040x}");
        Oid::new(hex).unwrap()
    }

    fn c(n: u64, parents: &[u64]) -> LayoutCommit {
        LayoutCommit {
            oid: oid(n),
            parents: parents.iter().copied().map(oid).collect(),
        }
    }

    fn lane_of(rows: &[RowLayoutDto], target: &Oid) -> usize {
        rows.iter().find(|r| &r.oid == target).unwrap().lane
    }

    #[test]
    fn linear_history_uses_single_lane() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("head");
        let page = vec![c(3, &[2]), c(2, &[1]), c(1, &[])];
        let delta = layout.append(&page);
        assert_eq!(delta.rows.len(), 3);
        assert!(delta.rows.iter().all(|r| r.lane == 0));
        assert_eq!(delta.lane_count, 1);
        assert!(delta.resolved.is_empty());
        assert!(!delta.rows[0].parents[0].pending);
    }

    #[test]
    fn merge_allocates_parent_lane_and_converges() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("all");
        // 5 = merge(4 main, 3 feature); 3 = parent 1; 4 = parent 2; 2 -> 1; 1 root
        let page = vec![c(5, &[4, 3]), c(3, &[1]), c(4, &[2]), c(2, &[1]), c(1, &[])];
        let delta = layout.append(&page);
        let rows = delta.rows;
        assert_eq!(rows[0].lane, 0);
        assert_eq!(rows[0].parents[0].lane, 0);
        assert_eq!(rows[0].parents[1].lane, 1);
        let feature_row = rows.iter().find(|r| r.oid == oid(3)).unwrap();
        assert_eq!(feature_row.lane, 1);
        let root_row = rows.iter().find(|r| r.oid == oid(1)).unwrap();
        // root 被两条 lane 期待，节点落在较小 lane，另一条汇入。
        assert_eq!(root_row.lane, 0);
        assert!(root_row.converging_lanes.contains(&1));
    }

    #[test]
    fn lanes_are_stable_across_pages() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("all");
        let page1 = vec![c(6, &[5, 2]), c(5, &[4]), c(4, &[3]), c(2, &[1])];
        let delta1 = layout.append(&page1);
        let snapshot: Vec<(Oid, usize)> = delta1
            .rows
            .iter()
            .map(|r| (r.oid.clone(), r.lane))
            .collect();
        let page2 = vec![c(3, &[1]), c(1, &[])];
        layout.append(&page2);
        for (commit, lane) in snapshot {
            assert_eq!(
                lane_of(layout.rows(), &commit),
                lane,
                "lane 不稳定: {commit}"
            );
        }
    }

    #[test]
    fn pending_edge_resolves_when_parent_arrives() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("head");
        let first = layout.append(&[c(2, &[1])]);
        assert!(first.rows[0].parents[0].pending);
        assert!(first.resolved.is_empty());

        let second = layout.append(&[c(1, &[])]);
        assert_eq!(second.resolved.len(), 1);
        assert_eq!(second.resolved[0].parent, oid(1));
        assert!(!layout.rows()[0].parents[0].pending);
    }

    #[test]
    fn merge_commit_converges_into_existing_lane() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("all");
        // 4 = merge(3, 5)；3 与 5 都以 2 为父提交，两 lane 在 2 汇入 lane 0。
        let page = vec![c(4, &[3, 5]), c(3, &[2]), c(5, &[2]), c(2, &[1]), c(1, &[])];
        let delta = layout.append(&page);
        let four = delta.rows.iter().find(|r| r.oid == oid(4)).unwrap();
        assert_eq!(four.parents[1].lane, 1, "第二父提交占用新 lane");
        let two = delta.rows.iter().find(|r| r.oid == oid(2)).unwrap();
        assert_eq!(two.lane, 0);
        assert!(two.converging_lanes.contains(&1));
        // lane 1 在汇入行释放后可被后续提交复用。
        let one = delta.rows.iter().find(|r| r.oid == oid(1)).unwrap();
        assert_eq!(one.lane, 0);
    }

    #[test]
    fn reset_starts_fresh_lifecycle() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("head");
        layout.append(&[c(2, &[1])]);
        layout.reset("all");
        let delta = layout.append(&[c(9, &[])]);
        assert_eq!(delta.rows[0].lane, 0);
        assert_eq!(delta.lane_count, 1);
    }

    #[test]
    fn duplicate_commit_is_ignored() {
        let mut layout = GraphLayoutModule::new();
        layout.reset("head");
        layout.append(&[c(1, &[])]);
        let delta = layout.append(&[c(1, &[])]);
        assert!(delta.rows.is_empty());
        assert_eq!(layout.rows().len(), 1);
    }

    proptest::proptest! {
        #[test]
        fn random_dag_keeps_invariants(
            node_count in 1usize..80,
            seed in proptest::collection::vec(0u8..4, 1..300),
        ) {
            // 节点按 0..n 拓扑序（0 最新），边只能指向更大的索引。
            let mut parents: Vec<Vec<u64>> = vec![Vec::new(); node_count];
            for (i, slot) in parents.iter_mut().enumerate() {
                if i + 1 < node_count {
                    let take = (seed[i % seed.len()] % 3) as usize;
                    if take > 0 {
                        slot.push((i + 1) as u64);
                    }
                    if take > 1 && i + 2 < node_count {
                        slot.push((i + 2) as u64);
                    }
                }
            }
            let page: Vec<LayoutCommit> = (0..node_count)
                .map(|i| LayoutCommit {
                    oid: oid(i as u64),
                    parents: parents[i].iter().copied().map(oid).collect(),
                })
                .collect();

            let mut layout = GraphLayoutModule::new();
            layout.reset("prop");
            let mut snapshot: HashMap<Oid, usize> = HashMap::new();
            for chunk in page.chunks(7) {
                let delta = layout.append(chunk);
                for row in &delta.rows {
                    // 已输出行的 lane 不得变化。
                    if let Some(previous) = snapshot.get(&row.oid) {
                        prop_assert_eq!(*previous, row.lane);
                    }
                    snapshot.insert(row.oid.clone(), row.lane);
                    // 父提交的边必须指向有效 lane。
                    for edge in &row.parents {
                        prop_assert!(edge.lane < row.lane_count.max(1));
                    }
                }
                // 已渲染行的 lane 在后续页中保持。
                for row in layout.rows() {
                    prop_assert_eq!(snapshot.get(&row.oid).copied(), Some(row.lane));
                }
            }
            prop_assert_eq!(snapshot.len(), node_count);
            // 所有 pending 边最终都应解决。
            for row in layout.rows() {
                for edge in &row.parents {
                    prop_assert!(!edge.pending, "父边仍 pending: {:?}", edge.parent);
                }
            }
        }
    }
}
