//! diff 降级阈值与用户文案：git-read（blob diff）与 git-write（暂存区 diff）
//! 共用，防止两侧行为分叉。
//!
//! 阈值语义两侧一致：`MAX_DIFF_BYTES` 限制单文件内容大小（git-read 为单个
//! blob，git-write 为单个未跟踪文件），`MAX_PATCH_LINES` 限制 patch 行数。

use crate::dto::FileDiffDto;

/// 单文件内容上限；超出不生成文本差异。文案中的「2MB」与此对应。
pub const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
/// patch 行数上限；超出截断为前 N 行并置 truncated。
pub const MAX_PATCH_LINES: usize = 5000;

/// 文件超过大小上限的降级说明。
pub fn too_large_note() -> String {
    "文件超过 2MB，未生成文本差异".to_owned()
}

/// 二进制文件的降级说明。
pub fn binary_note() -> String {
    "二进制文件，无法显示文本差异".to_owned()
}

/// patch 截断的说明；`lines` 为保留的行数。
pub fn truncated_note(lines: usize) -> String {
    format!("差异超过 {lines} 行，仅显示前 {lines} 行")
}

/// 非 UTF-8 内容有损解码的说明。
pub fn encoding_fallback_note() -> String {
    "文件不是合法 UTF-8，已按有损方式解码显示".to_owned()
}

/// 对完整 patch 文本应用行数上限：超限截断并置 truncated 与 note；随后若
/// 发生编码降级则覆盖 note（与截断说明相比，编码提示更影响用户理解）。
/// binary / gitlink 等前置降级由调用方先行处理。
pub fn apply_patch_limit(dto: &mut FileDiffDto, patch: String) {
    let line_count = patch.lines().count();
    if line_count > MAX_PATCH_LINES {
        let truncated = patch
            .lines()
            .take(MAX_PATCH_LINES)
            .collect::<Vec<_>>()
            .join("\n");
        dto.patch = Some(truncated);
        dto.truncated = true;
        dto.set_note_arg(
            "diff_truncated_lines",
            "lines",
            MAX_PATCH_LINES.to_string(),
            truncated_note(MAX_PATCH_LINES),
        );
    } else {
        dto.patch = Some(patch);
    }
    if dto.encoding_fallback {
        dto.set_note("diff_encoding_fallback", encoding_fallback_note());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::FileStatus;

    fn dto(encoding_fallback: bool) -> FileDiffDto {
        FileDiffDto {
            generation: 0,
            path: "a.txt".into(),
            old_path: None,
            status: FileStatus::Modified,
            patch: None,
            binary: false,
            too_large: false,
            truncated: false,
            encoding_fallback,
            gitlink: false,
            gitlink_old: None,
            gitlink_new: None,
            additions: 0,
            deletions: 0,
            language: None,
            note: None,
            note_code: None,
            note_args: None,
        }
    }

    #[test]
    fn patch_within_limit_is_kept_whole() {
        let mut d = dto(false);
        apply_patch_limit(&mut d, "a\nb\n".into());
        assert_eq!(d.patch.as_deref(), Some("a\nb\n"));
        assert!(!d.truncated);
        assert!(d.note.is_none());
    }

    #[test]
    fn patch_beyond_limit_is_truncated_with_note() {
        let mut d = dto(false);
        let patch = (0..MAX_PATCH_LINES + 1)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        apply_patch_limit(&mut d, patch);
        assert!(d.truncated);
        assert_eq!(
            d.patch.as_ref().expect("截断 patch").lines().count(),
            MAX_PATCH_LINES
        );
        assert_eq!(
            d.note.as_deref(),
            Some(format!("差异超过 {MAX_PATCH_LINES} 行，仅显示前 {MAX_PATCH_LINES} 行").as_str())
        );
    }

    #[test]
    fn encoding_fallback_note_overrides_truncation_note() {
        let mut d = dto(true);
        let patch = (0..MAX_PATCH_LINES + 1)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        apply_patch_limit(&mut d, patch);
        assert!(d.truncated);
        assert_eq!(
            d.note.as_deref(),
            Some("文件不是合法 UTF-8，已按有损方式解码显示")
        );
    }

    #[test]
    fn note_helpers_cover_all_four_degradations() {
        assert_eq!(too_large_note(), "文件超过 2MB，未生成文本差异");
        assert_eq!(binary_note(), "二进制文件，无法显示文本差异");
        assert_eq!(truncated_note(5000), "差异超过 5000 行，仅显示前 5000 行");
        assert_eq!(
            encoding_fallback_note(),
            "文件不是合法 UTF-8，已按有损方式解码显示"
        );
    }
}
