use git_core::git_command;

use super::MINIMUM_GIT_VERSION;

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
