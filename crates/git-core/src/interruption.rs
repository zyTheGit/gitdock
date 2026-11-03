//! 中断态标记表与探测：唯一事实源，供 git-read / git-write / 应用外壳共用。
//!
//! 标记均为 per-worktree 文件，检测目录由调用方注入（git-read 用 gix 解析的
//! git_dir，git-write 用 `rev-parse --absolute-git-dir`）；本模块只做文件级
//! 存在性检查，不执行 Git 命令、不猜测操作细节。

use std::path::Path;

use crate::dto::{InterruptionDto, InterruptionKind};

/// 中断标记与归类；顺序即探测结果 kinds 的输出顺序。
pub const MARKERS: &[(&str, InterruptionKind)] = &[
    ("MERGE_HEAD", InterruptionKind::Merge),
    ("CHERRY_PICK_HEAD", InterruptionKind::CherryPick),
    ("REVERT_HEAD", InterruptionKind::Revert),
    ("REBASE_HEAD", InterruptionKind::Rebase),
    ("rebase-merge", InterruptionKind::Rebase),
    ("rebase-apply", InterruptionKind::Rebase),
    ("sequencer", InterruptionKind::Sequencer),
    ("index.lock", InterruptionKind::IndexLock),
];

/// 名字是否为已知中断标记；供文件监听等按名过滤的场景。
pub fn is_marker(name: &str) -> bool {
    MARKERS.iter().any(|(marker, _)| *marker == name)
}

/// 探测 git_dir 下存在哪些中断标记，返回按 MARKERS 顺序去重的 kinds。
pub fn detect_kinds(git_dir: &Path) -> Vec<InterruptionKind> {
    let mut kinds = Vec::new();
    for (name, kind) in MARKERS {
        if git_dir.join(name).exists() && !kinds.contains(kind) {
            kinds.push(*kind);
        }
    }
    kinds
}

/// 中断类型的用户可见名称；多个时以「、」连接。
pub fn kind_names(kinds: &[InterruptionKind]) -> String {
    kinds
        .iter()
        .map(|kind| match kind {
            InterruptionKind::Merge => "merge 未完成",
            InterruptionKind::CherryPick => "cherry-pick 未完成",
            InterruptionKind::Revert => "revert 未完成",
            InterruptionKind::Rebase => "rebase 未完成",
            InterruptionKind::Sequencer => "sequencer 未完成",
            InterruptionKind::IndexLock => "index.lock 被占用",
        })
        .collect::<Vec<_>>()
        .join("、")
}

/// 终端接管提示；按优先级取第一个命中的中断类型给出具体命令。
pub fn terminal_hint(kinds: &[InterruptionKind]) -> String {
    if kinds.contains(&InterruptionKind::IndexLock) {
        return "请确认没有其他 Git 进程后，在终端手动删除 index.lock；本应用不会删除任何锁文件"
            .into();
    }
    if kinds.contains(&InterruptionKind::CherryPick) {
        return "请在终端解决冲突后执行 git cherry-pick --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Revert) {
        return "请在终端解决冲突后执行 git revert --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Rebase) {
        return "请在终端执行 git rebase --continue（或 --abort）".into();
    }
    if kinds.contains(&InterruptionKind::Merge) {
        return "请在终端执行 git merge --continue（或 git merge --abort）".into();
    }
    "请在终端完成或放弃当前操作".into()
}

/// 探测 git_dir 并组装共享文案的 InterruptionDto；files 由调用方提供
/// （git-write 填冲突文件清单，git-read 保持为空）。
pub fn interruption_dto(git_dir: &Path, files: Vec<String>) -> InterruptionDto {
    let kinds = detect_kinds(git_dir);
    if kinds.is_empty() {
        return InterruptionDto::none();
    }
    InterruptionDto {
        message: format!("检测到未完成的 Git 操作：{}", kind_names(&kinds)),
        terminal_hint: terminal_hint(&kinds),
        files,
        kinds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时 git_dir：按测试名隔离，结束整体删除。
    fn temp_git_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "git-core-interruption-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn is_marker_matches_all_marker_names_and_rejects_others() {
        for (name, _) in MARKERS {
            assert!(is_marker(name), "{name} 应识别为中断标记");
        }
        assert!(!is_marker("HEAD"));
        assert!(!is_marker("packed-refs"));
        assert!(!is_marker(""));
    }

    #[test]
    fn detect_kinds_deduplicates_rebase_markers_in_table_order() {
        let dir = temp_git_dir("rebase");
        // 三个 rebase 标记同时存在只归为一个 Rebase，且顺序按 MARKERS 表。
        std::fs::write(dir.join("rebase-merge"), b"").expect("写标记");
        std::fs::write(dir.join("rebase-apply"), b"").expect("写标记");
        std::fs::write(dir.join("REBASE_HEAD"), b"").expect("写标记");
        std::fs::write(dir.join("MERGE_HEAD"), b"").expect("写标记");
        assert_eq!(
            detect_kinds(&dir),
            vec![InterruptionKind::Merge, InterruptionKind::Rebase]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn interruption_dto_reports_none_without_markers_and_message_with_them() {
        let dir = temp_git_dir("dto");
        let none = interruption_dto(&dir, Vec::new());
        assert!(!none.is_active());
        assert_eq!(none.message, "无中断操作");

        std::fs::write(dir.join("CHERRY_PICK_HEAD"), b"").expect("写标记");
        let active = interruption_dto(&dir, vec!["conflict.txt".into()]);
        assert_eq!(active.kinds, vec![InterruptionKind::CherryPick]);
        assert_eq!(active.files, vec!["conflict.txt".to_owned()]);
        assert_eq!(
            active.message,
            "检测到未完成的 Git 操作：cherry-pick 未完成"
        );
        assert!(active.terminal_hint.contains("cherry-pick --continue"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn terminal_hint_prefers_index_lock_over_other_kinds() {
        let kinds = [InterruptionKind::CherryPick, InterruptionKind::IndexLock];
        assert!(terminal_hint(&kinds).contains("index.lock"));
        assert!(terminal_hint(&[InterruptionKind::Merge]).contains("git merge --continue"));
        assert_eq!(terminal_hint(&[]), "请在终端完成或放弃当前操作");
    }
}
