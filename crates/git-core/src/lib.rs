//! 领域模型、DTO 与跨模块契约。
//!
//! 本 crate 不了解 gix 或仓库文件布局，只定义稳定的数据形状、不变量、
//! 各层共用的子进程启动辅助（`process`）、中断态探测内核（`interruption`）
//! 与 diff 降级阈值/文案（`diff_limit`）。

pub mod cursor;
pub mod diff_limit;
pub mod dto;
pub mod error;
pub mod external_tool;
pub mod interruption;
pub mod language;
pub mod oid;
pub mod process;

pub use cursor::{decode_cursor, encode_cursor, CursorData};
pub use diff_limit::{
    apply_patch_limit, binary_note, encoding_fallback_note, too_large_note, truncated_note,
    MAX_DIFF_BYTES, MAX_PATCH_LINES,
};
pub use dto::*;
pub use error::{ErrorCode, Result, UserVisibleError};
pub use external_tool::{render_args_template, split_args_template};
pub use interruption::{
    detect_kinds, interruption_dto, is_marker, kind_names, terminal_hint, MARKERS,
};
pub use language::language_for;
pub use oid::{ObjectFormat, Oid, OidError};
pub use process::{git_command, hide_console, lossy_text};
