use std::path::Path;

use git_core::{git_command, InterruptionDto, InterruptionKind};

use super::{INTERRUPTION_MARKERS, MINIMUM_GIT_VERSION};

pub(crate) fn detect_interruption(git_dir: &Path) -> InterruptionDto {
    let mut kinds = Vec::new();
    for (marker, kind) in INTERRUPTION_MARKERS {
        if git_dir.join(marker).exists() && !kinds.contains(kind) {
            kinds.push(*kind);
        }
    }
    if kinds.is_empty() {
        return InterruptionDto::none();
    }
    let labels: Vec<&str> = kinds
        .iter()
        .map(|kind| match kind {
            InterruptionKind::Merge => "合并",
            InterruptionKind::CherryPick => "cherry-pick",
            InterruptionKind::Revert => "revert",
            InterruptionKind::Rebase => "rebase",
            InterruptionKind::Sequencer => "序列操作",
            InterruptionKind::IndexLock => "index 锁",
        })
        .collect();
    InterruptionDto {
        kinds,
        files: Vec::new(),
        message: format!("仓库存在未完成的{}操作", labels.join("、")),
        terminal_hint: "请在终端中检查并完成或中止该操作；本应用不会自动执行 abort/quit".to_owned(),
    }
}

/// 探测系统 Git 版本与最低版本支持情况；供应用外壳展示能力。
pub fn detect_git_version() -> (Option<String>, bool) {
    let output = git_command().arg("--version").output();
    let Ok(output) = output else {
        return (None, false);
    };
    if !output.status.success() {
        return (None, false);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text
        .trim()
        .strip_prefix("git version ")
        .unwrap_or(text.trim())
        .to_owned();
    let supported = version_at_least(&version, MINIMUM_GIT_VERSION);
    (Some(version), supported)
}

fn version_at_least(actual: &str, minimum: &str) -> bool {
    fn parts(value: &str) -> Vec<u64> {
        value
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    }
    let actual = parts(actual);
    let minimum = parts(minimum);
    for index in 0..3 {
        let a = actual.get(index).copied().unwrap_or(0);
        let m = minimum.get(index).copied().unwrap_or(0);
        if a != m {
            return a > m;
        }
    }
    true
}
