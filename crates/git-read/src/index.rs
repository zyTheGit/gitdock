//! 拓扑索引：一次性加载某视图可达提交，再按子先于父的顺序稳定分页。
//!
//! gix 自带的遍历排序不提供严格的 topo-order；这里用 Kahn 算法在已加载 DAG 上排序，
//! 保证父提交不会早于其子提交出现。索引以 generation + view_key 为键持久化到应用缓存目录。

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::{Path, PathBuf};

use git_core::{ErrorCode, Oid, Result, UserVisibleError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CACHE_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexNode {
    pub parents: Vec<String>,
    pub time: i64,
}

#[derive(Debug, Clone)]
pub struct GraphIndex {
    pub view_key: String,
    pub generation: u64,
    pub order: Vec<Oid>,
    pub nodes: HashMap<Oid, IndexNode>,
    pub positions: HashMap<Oid, usize>,
}

#[derive(Serialize, Deserialize)]
struct CacheFile {
    version: u8,
    view_key: String,
    generation: u64,
    order: Vec<String>,
    nodes: HashMap<String, IndexNode>,
}

#[derive(PartialEq, Eq)]
struct HeapItem {
    time: i64,
    oid: String,
}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        self.time
            .cmp(&other.time)
            .then_with(|| other.oid.cmp(&self.oid))
    }
}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl GraphIndex {
    pub fn position(&self, oid: &Oid) -> Option<usize> {
        self.positions.get(oid).copied()
    }

    pub fn order_slice(&self, start: usize, len: usize) -> &[Oid] {
        let end = (start + len).min(self.order.len());
        if start >= end {
            &[]
        } else {
            &self.order[start..end]
        }
    }
}

/// 使用 gix 读取所有可达提交，随后做严格拓扑排序。
pub fn build(
    repo: &gix::Repository,
    tips: &[Oid],
    view_key: &str,
    generation: u64,
    cache_dir: Option<&Path>,
) -> Result<GraphIndex> {
    let cache_path = cache_dir.map(|dir| cache_file_path(dir, repo, view_key, generation));
    if let Some(path) = &cache_path {
        if let Some(index) = load_cache(path, view_key, generation) {
            return Ok(index);
        }
    }

    let mut nodes: HashMap<Oid, IndexNode> = HashMap::new();
    let gix_tips: Vec<gix::hash::ObjectId> = tips
        .iter()
        .map(|oid| to_gix_oid(oid))
        .collect::<Result<Vec<_>>>()?;
    if gix_tips.is_empty() {
        return Ok(finish(vec![], nodes, view_key, generation, None));
    }
    let walk = repo
        .rev_walk(gix_tips)
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(|e| internal("遍历提交失败", e))?;

    for info in walk {
        let info = info.map_err(|e| internal("读取提交遍历结果失败", e))?;
        let oid = Oid::new(info.id.to_string()).expect("gix OID 长度合法");
        let parents = info
            .parent_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>();
        let time = info.commit_time.unwrap_or(0);
        nodes.insert(oid, IndexNode { parents, time });
    }

    let order = topo_order(&nodes);
    Ok(finish(
        order,
        nodes,
        view_key,
        generation,
        cache_path.as_deref(),
    ))
}

fn finish(
    order: Vec<Oid>,
    nodes: HashMap<Oid, IndexNode>,
    view_key: &str,
    generation: u64,
    cache_path: Option<&Path>,
) -> GraphIndex {
    let mut positions = HashMap::with_capacity(order.len());
    for (i, oid) in order.iter().enumerate() {
        positions.insert(oid.clone(), i);
    }
    let index = GraphIndex {
        view_key: view_key.to_owned(),
        generation,
        order,
        nodes,
        positions,
    };
    if let Some(path) = cache_path {
        let _ = write_cache(path, &index);
    }
    index
}

/// Kahn 拓扑排序：只有所有已知子提交都输出后，父提交才入堆。
/// 同一时刻可输出的提交按提交时间从新到旧排列，保证结果稳定。
fn topo_order(nodes: &HashMap<Oid, IndexNode>) -> Vec<Oid> {
    let mut child_counts: HashMap<&Oid, usize> = nodes.keys().map(|oid| (oid, 0usize)).collect();
    for node in nodes.values() {
        for parent in &node.parents {
            if let Ok(parent_oid) = Oid::new(parent.clone()) {
                if let Some(count) = child_counts.get_mut(&parent_oid) {
                    *count += 1;
                }
            }
        }
    }

    let mut heap = BinaryHeap::new();
    for (oid, count) in &child_counts {
        if *count == 0 {
            let time = nodes.get(*oid).map(|n| n.time).unwrap_or(0);
            heap.push(HeapItem {
                time,
                oid: oid.as_str().to_owned(),
            });
        }
    }

    let mut order = Vec::with_capacity(nodes.len());
    while let Some(item) = heap.pop() {
        let oid = Oid::new(item.oid).expect("堆中 OID 合法");
        if let Some(node) = nodes.get(&oid) {
            for parent in &node.parents {
                if let Ok(parent_oid) = Oid::new(parent.clone()) {
                    if let Some(count) = child_counts.get_mut(&parent_oid) {
                        if *count > 0 {
                            *count -= 1;
                        }
                        if *count == 0 {
                            let time = nodes.get(&parent_oid).map(|n| n.time).unwrap_or(0);
                            heap.push(HeapItem {
                                time,
                                oid: parent_oid.as_str().to_owned(),
                            });
                        }
                    }
                }
            }
        }
        order.push(oid);
    }

    // 防御：图不应有环；若有异常数据，剩余节点按时间追加，避免静默丢失。
    if order.len() != nodes.len() {
        let mut rest: Vec<_> = nodes
            .iter()
            .filter(|(oid, _)| !order.contains(oid))
            .map(|(oid, node)| (node.time, oid.clone()))
            .collect();
        rest.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        order.extend(rest.into_iter().map(|(_, oid)| oid));
    }
    order
}

pub fn to_gix_oid(oid: &Oid) -> Result<gix::hash::ObjectId> {
    gix::hash::ObjectId::from_hex(oid.as_str().as_bytes()).map_err(|e| {
        UserVisibleError::new(ErrorCode::Internal, "OID 无法转换为 gix 对象 ID")
            .with_detail(e.to_string())
    })
}

fn cache_file_path(dir: &Path, repo: &gix::Repository, view_key: &str, generation: u64) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(repo.git_dir().to_string_lossy().as_bytes());
    hasher.update(b"|");
    hasher.update(view_key.as_bytes());
    hasher.update(b"|");
    hasher.update(generation.to_le_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    dir.join(format!("{hex}.json"))
}

fn load_cache(path: &Path, view_key: &str, generation: u64) -> Option<GraphIndex> {
    let bytes = std::fs::read(path).ok()?;
    let file: CacheFile = serde_json::from_slice(&bytes).ok()?;
    if file.version != CACHE_VERSION || file.view_key != view_key || file.generation != generation {
        return None;
    }
    // 缓存必须与当前 refs/HEAD 指纹一致；generation 已包含该指纹。
    let mut nodes = HashMap::with_capacity(file.nodes.len());
    for (key, node) in file.nodes {
        nodes.insert(Oid::new(key).ok()?, node);
    }
    let mut order = Vec::with_capacity(file.order.len());
    for key in file.order {
        order.push(Oid::new(key).ok()?);
    }
    if order.len() != nodes.len() {
        return None;
    }
    let mut positions = HashMap::with_capacity(order.len());
    for (i, oid) in order.iter().enumerate() {
        positions.insert(oid.clone(), i);
    }
    Some(GraphIndex {
        view_key: view_key.to_owned(),
        generation,
        order,
        nodes,
        positions,
    })
}

fn write_cache(path: &Path, index: &GraphIndex) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = CacheFile {
        version: CACHE_VERSION,
        view_key: index.view_key.clone(),
        generation: index.generation,
        order: index.order.iter().map(|o| o.as_str().to_owned()).collect(),
        nodes: index
            .nodes
            .iter()
            .map(|(oid, node)| (oid.as_str().to_owned(), node.clone()))
            .collect(),
    };
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&file)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn internal(message: &str, err: impl std::fmt::Display) -> UserVisibleError {
    UserVisibleError::new(ErrorCode::Internal, message).with_detail(err.to_string())
}
