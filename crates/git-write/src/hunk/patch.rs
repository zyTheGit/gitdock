//! unified diff 的字节级拆分与重组（ADR-0027）。
//!
//! `git diff` 的输出是字节流：文件内容可能是任意编码，行尾可能是 `\r\n`。这里只在
//! `\n` 上切行、每行原样保留字节（含结尾 `\r` 与 `\ No newline at end of file` 标记），
//! 不转成 `String`，避免编码回落或行尾归一化把补丁改坏。

/// 文件头（首块 `@@` 之前的全部字节）与按输出顺序排列的 hunk。
pub(crate) struct SplitPatch<'a> {
    /// `diff --git`、`index`、`---` / `+++` 等文件级行；喂给 `git apply` 时必需。
    pub(crate) header: &'a [u8],
    /// 每块包含自己的 `@@ ... @@` 行，直到下一块 `@@` 之前（末块到输出结尾）。
    pub(crate) hunks: Vec<&'a [u8]>,
}

/// 按行扫描：以 `@@ ` 开头的行是 hunk 起点。内容行总带前缀（` `/`+`/`-`/`\`），
/// 因此内容里出现的 `@@` 不会误判成块边界。
pub(crate) fn split_patch(bytes: &[u8]) -> SplitPatch<'_> {
    let starts = hunk_starts(bytes);
    let header_end = starts.first().copied().unwrap_or(bytes.len());
    let hunks = starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts.get(index + 1).copied().unwrap_or(bytes.len());
            &bytes[*start..end]
        })
        .collect();
    SplitPatch {
        header: &bytes[..header_end],
        hunks,
    }
}

/// 输出中的 hunk 数量；二进制 diff 与仅模式变更的 diff 没有 hunk，因此为 0。
pub(crate) fn hunk_count(bytes: &[u8]) -> usize {
    hunk_starts(bytes).len()
}

/// 取出「文件头 + 第 `index` 块」组成的单 hunk 补丁。
///
/// 返回 `None` 表示：没有文件头、序号越界，或重组结果不是恰好一块（防御性校验）。
pub(crate) fn select_hunk(bytes: &[u8], index: u32) -> Option<Vec<u8>> {
    let split = split_patch(bytes);
    if split.header.is_empty() {
        return None;
    }
    let hunk = split.hunks.get(index as usize)?;
    let mut patch = Vec::with_capacity(split.header.len() + hunk.len());
    patch.extend_from_slice(split.header);
    patch.extend_from_slice(hunk);
    // `git apply` 要求补丁以换行结束；git 自己总是给出换行，这里只做兜底。
    if !patch.ends_with(b"\n") {
        patch.push(b'\n');
    }
    (hunk_count(&patch) == 1).then_some(patch)
}

/// 二进制 diff：`Binary files ... differ` 或 `GIT binary patch`，没有可应用的文本 hunk。
pub(crate) fn is_binary(bytes: &[u8]) -> bool {
    contains(bytes, b"Binary files") || contains(bytes, b"GIT binary patch")
}

/// 子模块 gitlink：`Subproject commit`，索引里是提交指针而不是文件内容。
pub(crate) fn is_gitlink(bytes: &[u8]) -> bool {
    contains(bytes, b"Subproject commit")
}

fn hunk_starts(bytes: &[u8]) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        let end = match bytes[pos..].iter().position(|byte| *byte == b'\n') {
            Some(offset) => pos + offset + 1,
            None => bytes.len(),
        };
        if bytes[pos..].starts_with(b"@@ ") {
            starts.push(pos);
        }
        pos = end;
    }
    starts
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 三段彼此分离的修改：交给 `git diff --unified=3` 时必然切成三块。
    fn multi_hunk_diff() -> Vec<u8> {
        let mut text = String::new();
        text.push_str("diff --git a/f.txt b/f.txt\n");
        text.push_str("index fde2dee..ded6e8b 100644\n");
        text.push_str("--- a/f.txt\n");
        text.push_str("+++ b/f.txt\n");
        for hunk in [1, 2, 3] {
            text.push_str(&format!("@@ -{hunk},3 +{hunk},3 @@\n"));
            text.push_str(" line\n");
            text.push_str(&format!("-old{hunk}\n+new{hunk}\n"));
            text.push_str(" tail\n");
        }
        text.into_bytes()
    }

    #[test]
    fn split_separates_header_and_every_hunk() {
        let diff = multi_hunk_diff();
        let split = split_patch(&diff);
        assert!(split.header.starts_with(b"diff --git a/f.txt b/f.txt"));
        assert!(split.header.ends_with(b"+++ b/f.txt\n"));
        assert_eq!(split.hunks.len(), 3);
        assert_eq!(hunk_count(&diff), 3);
        for hunk in &split.hunks {
            assert!(hunk.starts_with(b"@@ "));
        }
        // 最后一块到输出结尾，重组回来必须与原始 diff 逐字节一致。
        let rebuilt: Vec<u8> = split
            .header
            .iter()
            .chain(split.hunks.iter().flat_map(|hunk| hunk.iter()))
            .copied()
            .collect();
        assert_eq!(rebuilt, diff);
    }

    #[test]
    fn select_hunk_keeps_header_and_only_that_hunk() {
        let diff = multi_hunk_diff();
        let patch = select_hunk(&diff, 1).expect("第二块存在");
        assert_eq!(hunk_count(&patch), 1);
        assert!(patch.starts_with(b"diff --git a/f.txt b/f.txt"));
        assert!(patch.windows(10).any(|w| w == b"-old2\n+new"));
        assert!(!patch.windows(10).any(|w| w == b"-old1\n+new"));
        assert!(!patch.windows(10).any(|w| w == b"-old3\n+new"));
        // 越界与空块一律拒绝。
        assert!(select_hunk(&diff, 3).is_none());
        assert!(select_hunk(&diff, u32::MAX).is_none());
        assert!(select_hunk(b"", 0).is_none());
        assert!(select_hunk(b"diff --git a/f b/f\n", 0).is_none());
    }

    #[test]
    fn select_hunk_preserves_no_newline_marker_and_crlf() {
        let mut diff = Vec::new();
        diff.extend_from_slice(b"diff --git a/f.txt b/f.txt\n");
        diff.extend_from_slice(b"--- a/f.txt\n");
        diff.extend_from_slice(b"+++ b/f.txt\n");
        diff.extend_from_slice(b"@@ -1,2 +1,2 @@\n");
        diff.extend_from_slice(b" a\r\n");
        diff.extend_from_slice(b"-b\r\n");
        diff.extend_from_slice(b"\\ No newline at end of file\n");
        diff.extend_from_slice(b"+b\r\n");
        diff.extend_from_slice(b"\\ No newline at end of file\n");
        let patch = select_hunk(&diff, 0).expect("单块补丁");
        assert_eq!(patch, diff);
        assert!(contains(&patch, b"\\ No newline at end of file\n"));
        // CRLF 的内容行不被归一化：`\r` 原样保留在行内。
        assert!(contains(&patch, b" a\r\n"));
    }

    #[test]
    fn binary_and_gitlink_diffs_are_recognized() {
        let binary = b"diff --git a/b.bin b/b.bin\nBinary files a/b.bin and b/b.bin differ\n";
        assert!(is_binary(binary));
        assert_eq!(hunk_count(binary), 0);
        assert!(select_hunk(binary, 0).is_none());

        let link = b"diff --git a/sub b/sub\nindex 1..2 160000\n--- a/sub\n+++ b/sub\n@@ -1 +1 @@\n-Subproject commit aaaa\n+Subproject commit bbbb\n";
        assert!(is_gitlink(link));
        assert!(!is_binary(link));
    }

    #[test]
    fn header_lines_with_at_signs_are_not_mistaken_for_hunks() {
        // 内容行 ` @@ fake` 带上下文前缀，`+@@ fake` 带新增前缀，都不是块起点。
        let diff = b"diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-@@ fake\n+ @@ fake\n";
        assert_eq!(hunk_count(diff), 1);
        assert!(select_hunk(diff, 1).is_none());
    }
}
