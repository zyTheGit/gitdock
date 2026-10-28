//! 受限 Tauri command seam。
//!
//! 约束：前端只能调用这里注册的白名单 command；这里不接受命令字符串、不接受
//! 任意 `.git` 路径，也不向前端暴露 Git 原始对象。所有 Git 访问都经由
//! `GitReadModule`（只读）；写操作将在 W1 通过独立模块接入。

use std::path::PathBuf;
use std::sync::Arc;

use git_core::{
    CompareResultDto, CommitDetailDto, ErrorCode, FileDiffDto, GraphPageDto, GraphScope, Oid,
    RepoStateDto, Result, SearchPageDto, SearchRequest, UserVisibleError,
};
use git_read::{detect_git_version, GitReadModule, DEFAULT_PAGE_LIMIT, MINIMUM_GIT_VERSION};
use serde::Serialize;
use tauri::State;

use super::config::SettingsDto;
use super::logging;
use super::state::{AppState, Session};

type Shared = Arc<AppState>;

#[derive(Debug, Serialize)]
pub struct AppInfoDto {
    pub app_version: String,
    pub git_version: Option<String>,
    pub git_version_supported: bool,
    pub minimum_git_version: String,
    pub config_dir: String,
    pub log_path: String,
    pub platform: String,
}

#[tauri::command]
pub async fn app_info(state: State<'_, Shared>) -> Result<AppInfoDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let (git_version, git_version_supported) = detect_git_version();
        Ok(AppInfoDto {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            git_version,
            git_version_supported,
            minimum_git_version: MINIMUM_GIT_VERSION.to_owned(),
            config_dir: state.paths.config_dir.display().to_string(),
            log_path: state.paths.log_path.display().to_string(),
            platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        })
    })
    .await
}

#[tauri::command]
pub async fn load_settings(state: State<'_, Shared>) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.settings()).await
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, Shared>,
    settings: SettingsDto,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.save_settings(settings)).await
}

#[tauri::command]
pub async fn remember_repository(
    state: State<'_, Shared>,
    path: String,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.remember_repository(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn open_repository(state: State<'_, Shared>, path: String) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let dir = PathBuf::from(path);
        let canonical = std::fs::canonicalize(&dir).map_err(|e| {
            UserVisibleError::new(ErrorCode::RepositoryNotFound, "仓库目录不存在或不可访问")
                .with_detail(e.to_string())
        })?;
        if !canonical.is_dir() {
            return Err(UserVisibleError::new(
                ErrorCode::InvalidArgument,
                "请选择仓库目录",
            ));
        }
        let open_path = PathBuf::from(super::config::strip_verbatim(&canonical));
        let read = GitReadModule::open(&open_path, Some(state.paths.index_cache_dir.clone()))?;
        let state_dto = read.state()?;
        logging::info(&format!(
            "打开仓库 {}（{}，generation {}）",
            state_dto.path,
            state_dto.object_format.as_str(),
            state_dto.generation
        ));
        state.replace_session(Some(Session { read }))?;
        Ok(state_dto)
    })
    .await
}

#[tauri::command]
pub async fn close_repository(state: State<'_, Shared>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.close()?;
        logging::info("关闭仓库");
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repository_state(state: State<'_, Shared>) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.read.state())).await
}

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
) -> Result<CompareResultDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let base = parse_oid(&base)?;
        let compare = parse_oid(&compare_oid)?;
        state.with_session(|session| {
            session
                .read
                .compare(&base, &compare, path_filter.as_deref())
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
) -> Result<FileDiffDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let base = parse_oid(&base)?;
        let compare = parse_oid(&compare_oid)?;
        state.with_session(|session| session.read.compare_file_diff(&base, &compare, &path))
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
    blocking(move || {
        state.with_session(|session| session.read.search(&request, cursor.as_deref()))
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
        UserVisibleError::new(ErrorCode::InvalidArgument, "OID 格式无效").with_detail(e.to_string())
    })
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| UserVisibleError::internal(format!("后台任务异常：{e}")))?
}
