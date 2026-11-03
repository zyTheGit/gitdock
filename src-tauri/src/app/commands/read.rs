//! 读域 command：图页、提交详情、比较、搜索与外部 diff 工具。

use std::sync::Arc;

use git_core::{
    CommitBranchContextDto, CommitDetailDto, CompareResultDto, ErrorCode, FileDiffDto,
    GraphPageDto, GraphScope, Oid, Result, SearchPageDto, SearchRequest, UserVisibleError,
};
use git_read::DEFAULT_PAGE_LIMIT;
use tauri::State;

use super::{blocking, Shared};

#[tauri::command]
pub async fn read_graph_page(
    state: State<'_, Shared>,
    scope: GraphScope,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<GraphPageDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            session.read.read_graph_page(
                &scope,
                cursor.as_deref(),
                limit.unwrap_or(DEFAULT_PAGE_LIMIT),
            )
        })
    })
    .await
}

#[tauri::command]
pub async fn read_graph_page_around(
    state: State<'_, Shared>,
    scope: GraphScope,
    oid: String,
    limit: Option<usize>,
) -> Result<GraphPageDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let oid = parse_oid(&oid)?;
        state.with_session(|session| {
            session
                .read
                .read_graph_page_around(&scope, &oid, limit.unwrap_or(DEFAULT_PAGE_LIMIT))
        })
    })
    .await
}

#[tauri::command]
pub async fn read_commit(state: State<'_, Shared>, oid: String) -> Result<CommitDetailDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let oid = parse_oid(&oid)?;
        state.with_session(|session| session.read.read_commit(&oid))
    })
    .await
}

#[tauri::command]
pub async fn branches_containing(state: State<'_, Shared>, oid: String) -> Result<Vec<String>> {
    let state = Arc::clone(&state);
    blocking(move || {
        let oid = parse_oid(&oid)?;
        state.with_session(|session| session.read.branches_containing(&oid))
    })
    .await
}

#[tauri::command]
pub async fn commit_branch_context(
    state: State<'_, Shared>,
    oid: String,
    limit: Option<u32>,
) -> Result<CommitBranchContextDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let oid = parse_oid(&oid)?;
        let limit = limit.unwrap_or(3).clamp(1, 20) as usize;
        state.with_session(|session| session.read.commit_branch_context(&oid, limit))
    })
    .await
}

#[tauri::command]
pub async fn read_file_diff(
    state: State<'_, Shared>,
    oid: String,
    path: String,
) -> Result<FileDiffDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let oid = parse_oid(&oid)?;
        state.with_session(|session| session.read.read_file_diff(&oid, &path))
    })
    .await
}

#[tauri::command]
pub async fn compare_commits(
    state: State<'_, Shared>,
    base: String,
    compare_oid: String,
    path_filter: Option<String>,
    two_dot: bool,
) -> Result<CompareResultDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let base = parse_oid(&base)?;
        let compare = parse_oid(&compare_oid)?;
        state.with_session(|session| {
            session
                .read
                .compare(&base, &compare, path_filter.as_deref(), two_dot)
        })
    })
    .await
}

#[tauri::command]
pub async fn compare_file_diff(
    state: State<'_, Shared>,
    base: String,
    compare_oid: String,
    path: String,
    two_dot: bool,
) -> Result<FileDiffDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let base = parse_oid(&base)?;
        let compare = parse_oid(&compare_oid)?;
        state.with_session(|session| {
            session
                .read
                .compare_file_diff(&base, &compare, &path, two_dot)
        })
    })
    .await
}

#[tauri::command]
pub async fn search(
    state: State<'_, Shared>,
    request: SearchRequest,
    cursor: Option<String>,
) -> Result<SearchPageDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.read.search(&request, cursor.as_deref())))
        .await
}

const MAX_EXTERNAL_BYTES: usize = 50 * 1024 * 1024;

/// 用已保存的外部工具比较单个文件；临时文件写入独立目录，进程以参数数组启动。
#[tauri::command]
pub async fn launch_external_diff(
    state: State<'_, Shared>,
    tool_index: usize,
    left: Option<String>,
    right: String,
    path: String,
    three_dot: bool,
) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        let tool = state
            .settings()?
            .external_tools
            .get(tool_index)
            .cloned()
            .ok_or_else(|| {
                UserVisibleError::new(ErrorCode::InvalidArgument, "外部工具不存在，请重新配置")
                    .with_key("errors.externalToolNotFound")
            })?;
        let left = left.map(|value| parse_oid(&value)).transpose()?;
        let right = parse_oid(&right)?;
        let sides = state.with_session(|session| {
            session
                .read
                .file_sides(left.as_ref(), &right, &path, three_dot)
        })?;
        if sides.old.len() > MAX_EXTERNAL_BYTES || sides.new.len() > MAX_EXTERNAL_BYTES {
            return Err(UserVisibleError::new(
                ErrorCode::ExternalToolFailed,
                "文件超过 50MB，未交给外部工具",
            )
            .with_key("errors.externalFileTooLarge"));
        }
        let dir = crate::app::external::prepare_dir(&state.paths.external_tmp_dir, &path)?;
        let name = crate::app::external::safe_file_name(&path);
        let local = dir.join(format!("local-{name}"));
        let remote = dir.join(format!("remote-{name}"));
        let write = |target: &std::path::Path, bytes: &[u8]| {
            std::fs::write(target, bytes).map_err(|e| {
                UserVisibleError::new(ErrorCode::Io, "写入外部 diff 临时文件失败")
                    .with_key("errors.externalTempFileWriteFailed")
                    .with_detail(e.to_string())
            })
        };
        write(&local, &sides.old)?;
        write(&remote, &sides.new)?;
        crate::app::external::launch(&tool, &local, &remote)
    })
    .await
}

#[tauri::command]
pub async fn cancel_search(state: State<'_, Shared>, search_id: String) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            session.read.cancel_search(&search_id);
            Ok(())
        })
    })
    .await
}

fn parse_oid(value: &str) -> Result<Oid> {
    Oid::new(value).map_err(|e| {
        UserVisibleError::new(ErrorCode::InvalidArgument, "OID 格式无效")
            .with_key("errors.oidFormatInvalid")
            .with_detail(e.to_string())
    })
}
