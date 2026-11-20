//! 统一 diff 文本生成：普通模式复用 `similar` 的输出，忽略空白模式自行拼装 hunk。
//!
//! `ignore_whitespace` 的语义对齐 `git diff -w`（忽略行内与行尾空白）：比较时把每行
//! 去掉全部空白字符作为 key，展示时仍输出原始行。代价是忽略模式不输出
//! `\ No newline at end of file` 标记，且「仅行尾换行差异」会被视为相同（ADR-0030）。

use similar::{DiffOp, TextDiff};

/// 一次 patch 生成的结果：文本与增删行数。
pub(crate) struct PatchText {
    pub text: String,
    pub additions: u32,
    pub deletions: u32,
}

/// 生成 `a/<path>` → `b/<path>` 的统一 diff（上下文 3 行）。
pub(crate) fn build_patch(
    path: &str,
    old_text: &str,
    new_text: &str,
    ignore_whitespace: bool,
) -> PatchText {
    if ignore_whitespace {
        whitespace_patch(path, old_text, new_text)
    } else {
        exact_patch(path, old_text, new_text)
    }
}

fn exact_patch(path: &str, old_text: &str, new_text: &str) -> PatchText {
    let diff = TextDiff::from_lines(old_text, new_text);
    let mut additions = 0;
    let mut deletions = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => additions += 1,
            similar::ChangeTag::Delete => deletions += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    let text = diff
        .unified_diff()
        .context_radius(3)
        .header(&format!("a/{path}"), &format!("b/{path}"))
        .to_string();
    PatchText {
        text,
        additions,
        deletions,
    }
}

fn whitespace_patch(path: &str, old_text: &str, new_text: &str) -> PatchText {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();
    let old_keys: Vec<String> = old_lines
        .iter()
        .map(|line| strip_whitespace(line))
        .collect();
    let new_keys: Vec<String> = new_lines
        .iter()
        .map(|line| strip_whitespace(line))
        .collect();
    let old_refs: Vec<&str> = old_keys.iter().map(String::as_str).collect();
    let new_refs: Vec<&str> = new_keys.iter().map(String::as_str).collect();
    let diff = TextDiff::from_slices(&old_refs, &new_refs);

    let mut text = format!("--- a/{path}\n+++ b/{path}\n");
    let mut additions = 0;
    let mut deletions = 0;
    for group in diff.grouped_ops(3) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else {
            continue;
        };
        let old_range = first.old_range().start..last.old_range().end;
        let new_range = first.new_range().start..last.new_range().end;
        text.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            old_range.start + 1,
            old_range.len(),
            new_range.start + 1,
            new_range.len()
        ));
        for op in &group {
            let old = op.old_range();
            let new = op.new_range();
            match op {
                DiffOp::Equal { .. } => {
                    for index in old {
                        push_line(&mut text, ' ', old_lines[index]);
                    }
                }
                DiffOp::Delete { .. } => {
                    deletions += old.len() as u32;
                    for index in old {
                        push_line(&mut text, '-', old_lines[index]);
                    }
                }
                DiffOp::Insert { .. } => {
                    additions += new.len() as u32;
                    for index in new {
                        push_line(&mut text, '+', new_lines[index]);
                    }
                }
                DiffOp::Replace { .. } => {
                    deletions += old.len() as u32;
                    additions += new.len() as u32;
                    for index in old {
                        push_line(&mut text, '-', old_lines[index]);
                    }
                    for index in new {
                        push_line(&mut text, '+', new_lines[index]);
                    }
                }
            }
        }
    }
    PatchText {
        text,
        additions,
        deletions,
    }
}

fn strip_whitespace(line: &str) -> String {
    line.chars().filter(|c| !c.is_whitespace()).collect()
}

fn push_line(out: &mut String, prefix: char, line: &str) {
    out.push(prefix);
    out.push_str(line);
    out.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_patch_reports_additions_and_deletions() {
        let stats = build_patch("a.txt", "one\ntwo\n", "one\nthree\n", false);
        assert_eq!(stats.additions, 1);
        assert_eq!(stats.deletions, 1);
        assert!(stats.text.contains("--- a/a.txt"));
        assert!(stats.text.contains("+three"));
    }

    #[test]
    fn whitespace_only_change_is_ignored() {
        let stats = build_patch("a.txt", "let a = 1;\n", "let  a  =  1;\n", true);
        assert_eq!(stats.additions, 0);
        assert_eq!(stats.deletions, 0);
        assert_eq!(stats.text, "--- a/a.txt\n+++ b/a.txt\n");
    }

    #[test]
    fn whitespace_mode_keeps_real_changes_and_original_lines() {
        let stats = build_patch("a.txt", "a  1\nb\n", "a  2\nb\n", true);
        assert_eq!(stats.additions, 1);
        assert_eq!(stats.deletions, 1);
        assert!(stats.text.contains("-a  1"), "{}", stats.text);
        assert!(stats.text.contains("+a  2"), "{}", stats.text);
        assert!(stats.text.contains("@@ -1,2 +1,2 @@"), "{}", stats.text);
    }

    #[test]
    fn whitespace_mode_skips_unchanged_context() {
        let stats = build_patch("a.txt", "x\n y\nz\n", "x\n y\nq\n", true);
        // 上下文取原始行（保留行首空格），替换行前后各一行。
        assert_eq!(stats.text.lines().filter(|l| l.starts_with(' ')).count(), 2);
        assert!(stats.text.contains("+q"));
    }
}
