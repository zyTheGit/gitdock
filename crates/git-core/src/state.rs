use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::oid::Oid;

pub use crate::dto::WriteKind;

/// 会话状态模型。`Interrupted` 优先于普通写操作入口。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RepositorySession {
    Closed,
    Opening,
    Ready { generation: u64 },
    Refreshing { generation: u64 },
    Interrupted { kind: String, generation: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteOperationState {
    Idle,
    Validating,
    Running,
    Succeeded,
    Conflicted,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum CompareSelection {
    Empty,
    Base { oid: Oid },
    BaseAndCompare { base: Oid, compare: Oid },
}

/// generation 计数器；0 表示尚未打开仓库。
#[derive(Debug)]
pub struct GenerationClock {
    current: AtomicU64,
}

impl Default for GenerationClock {
    fn default() -> Self {
        Self {
            current: AtomicU64::new(0),
        }
    }
}

impl GenerationClock {
    pub fn current(&self) -> u64 {
        self.current.load(Ordering::SeqCst)
    }

    /// 开启新一代并返回。旧代的所有异步结果都将被拒绝。
    pub fn bump(&self) -> u64 {
        self.current.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn set(&self, value: u64) {
        self.current.store(value, Ordering::SeqCst);
    }
}
