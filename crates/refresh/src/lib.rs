//! RefreshCoordinator：合并文件监听、手动刷新与写操作触发的刷新请求，
//! 维护当前仓库代际，并拒绝过期的只读结果。
//!
//! 不变量：
//! - 监听事件只标脏，不直接改写 UI 数据；
//! - 同一待处理窗口内的重复监听事件合并为一次刷新；
//! - 只有与当前代际一致的结果才可提交 UI。

/// 刷新来源。监听与手动/写操作的区别在于：监听可合并，后两者开启新轮次。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshReason {
    Watch,
    Manual,
    Write,
}

#[derive(Debug, Default)]
pub struct RefreshCoordinator {
    generation: u64,
    dirty: bool,
    rounds: u64,
}

impl RefreshCoordinator {
    pub fn new() -> Self {
        Self::default()
    }

    /// 请求一次刷新，返回当前轮次。
    ///
    /// 监听事件只标脏并合并到同一轮次；手动刷新与写操作每次开启新轮次。
    pub fn request(&mut self, reason: RefreshReason) -> u64 {
        self.dirty = true;
        if matches!(reason, RefreshReason::Manual | RefreshReason::Write) {
            self.rounds += 1;
        }
        self.rounds
    }

    pub fn current_generation(&self) -> u64 {
        self.generation
    }

    /// 观察到外部变化后的仓库代际。返回代际是否变化；变化时应通知 UI 刷新。
    pub fn observe(&mut self, generation: u64) -> bool {
        if generation == self.generation {
            return false;
        }
        self.generation = generation;
        self.dirty = true;
        true
    }

    /// 记录 UI 已接受该代际的结果并清除脏标记。
    /// 首次结果建立代际；之后仅接受与当前观察一致的代际。
    pub fn accept(&mut self, result_generation: u64) -> bool {
        if self.generation == 0 {
            self.generation = result_generation;
            self.dirty = false;
            return true;
        }
        if result_generation == self.generation {
            self.dirty = false;
            return true;
        }
        false
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn rounds(&self) -> u64 {
        self.rounds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_events_coalesce_into_one_pending_round() {
        let mut coordinator = RefreshCoordinator::new();
        coordinator.request(RefreshReason::Watch);
        coordinator.request(RefreshReason::Watch);
        coordinator.request(RefreshReason::Watch);
        assert_eq!(coordinator.rounds(), 0);
        assert!(coordinator.is_dirty());
    }

    #[test]
    fn manual_and_write_requests_open_new_rounds() {
        let mut coordinator = RefreshCoordinator::new();
        assert_eq!(coordinator.request(RefreshReason::Manual), 1);
        assert_eq!(coordinator.request(RefreshReason::Watch), 1);
        assert_eq!(coordinator.request(RefreshReason::Write), 2);
    }

    #[test]
    fn first_accept_establishes_generation_and_clears_dirty() {
        let mut coordinator = RefreshCoordinator::new();
        coordinator.request(RefreshReason::Manual);
        assert!(coordinator.accept(42));
        assert_eq!(coordinator.current_generation(), 42);
        assert!(!coordinator.is_dirty());
    }

    #[test]
    fn stale_result_is_rejected_without_overwriting_generation() {
        let mut coordinator = RefreshCoordinator::new();
        assert!(coordinator.accept(42));
        assert!(!coordinator.accept(41));
        assert_eq!(coordinator.current_generation(), 42);

        coordinator.request(RefreshReason::Watch);
        assert!(coordinator.is_dirty());
        assert!(coordinator.accept(42));
        assert!(!coordinator.is_dirty());
    }

    #[test]
    fn observe_reports_only_real_generation_changes() {
        let mut coordinator = RefreshCoordinator::new();
        assert!(coordinator.observe(7));
        assert!(!coordinator.observe(7));
        assert!(coordinator.observe(8));
        assert_eq!(coordinator.current_generation(), 8);
    }

    #[test]
    fn observed_generation_change_rejects_older_pending_results() {
        let mut coordinator = RefreshCoordinator::new();
        coordinator.accept(7);
        coordinator.request(RefreshReason::Watch);
        coordinator.observe(8);
        assert!(!coordinator.accept(7));
        assert!(coordinator.accept(8));
    }
}
