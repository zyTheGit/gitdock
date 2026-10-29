//! 领域模型、DTO 与跨模块契约。
//!
//! 本 crate 不了解 gix 或仓库文件布局，只定义稳定的数据形状、不变量，以及
//! 各层共用的子进程启动辅助（`process`）。

pub mod cursor;
pub mod dto;
pub mod error;
pub mod external_tool;
pub mod oid;
pub mod process;
pub mod state;

pub use cursor::{decode_cursor, encode_cursor, CursorData};
pub use dto::*;
pub use error::{ErrorCode, Result, UserVisibleError};
pub use external_tool::{render_args_template, split_args_template};
pub use oid::{ObjectFormat, Oid, OidError};
pub use process::{git_command, hide_console};
pub use state::*;
