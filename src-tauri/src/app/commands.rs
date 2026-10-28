//! 受限 Tauri command seam。
//!
//! 约束：前端只能调用这里注册的白名单 command；这里不接受命令字符串、不接受
//! 任意 `.git` 路径，也不向前端暴露 Git 原始对象。只读访问经由 `GitReadModule`，
//! 写操作经由 `GitWriteModule`（内部只调用 Git CLI），二者都按结构化请求工作。

use std::path::PathBuf;
use std::sync::Arc;

use git_core::{
    BranchDescriptionDto, CompareResultDto, CommitDetailDto, ErrorCode, FileDiffDto, GateReportDto,
    GraphPageDto, GraphScope, InterruptionDto, Oid, RepoStateDto, Result, SearchPageDto,
    SearchRequest, UserVisibleError, WorkspaceStatusDto, WriteOutcomeDto, WriteRequest,
};
use git_read::{detect_git_version, GitReadModule, DEFAULT_PAGE_LIMIT, MINIMUM_GIT_VERSION};
use git_write::GitWriteModule;
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
        let write = GitWriteModule::new(&open_path)?;
        let state_dto = read.state()?;
        logging::info(&format!(
            "打开仓库 {}（{}，generation {}）",
            state_dto.path,
            state_dto.object_format.as_str(),
            state_dto.generation
        ));
        state.replace_session(Some(Session { read, write }))?;
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
            ));
        }
        let dir = super::external::prepare_dir(&state.paths.external_tmp_dir, &path)?;
        let name = super::external::safe_file_name(&path);
        let local = dir.join(format!("local-{name}"));
        let remote = dir.join(format!("remote-{name}"));
        let write = |target: &std::path::Path, bytes: &[u8]| {
            std::fs::write(target, bytes).map_err(|e| {
                UserVisibleError::new(ErrorCode::Io, "写入外部 diff 临时文件失败")
                    .with_detail(e.to_string())
            })
        };
        write(&local, &sides.old)?;
        write(&remote, &sides.new)?;
        super::external::launch(&tool, &local, &remote)
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

#[tauri::command]
pub async fn validate_write(
    state: State<'_, Shared>,
    request: WriteRequest,
) -> Result<GateReportDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.validate(&request))).await
}

/// 执行写操作。完成后重新探测 generation 与 HEAD，供前端判断是否刷新。
#[tauri::command]
pub async fn execute_write(
    state: State<'_, Shared>,
    request: WriteRequest,
) -> Result<WriteOutcomeDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            let mut outcome = session.write.execute(&request)?;
            match session.read.state() {
                Ok(repo) => {
                    outcome.generation = Some(repo.generation);
                    outcome.head_oid = repo.head.oid;
                }
                Err(err) => {
                    logging::warn(&format!("写操作后重新探测仓库状态失败：{err}"));
                }
            }
            Ok(outcome)
        })
    })
    .await
}

#[tauri::command]
pub async fn inspect_interruption(state: State<'_, Shared>) -> Result<InterruptionDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.inspect_interruption())).await
}

#[tauri::command]
pub async fn workspace_status(state: State<'_, Shared>) -> Result<WorkspaceStatusDto> {
    let state = Arc::clone(&state);
    blocking(move || state.with_session(|session| session.write.workspace_status())).await
}

#[tauri::command]
pub async fn read_branch_description(
    state: State<'_, Shared>,
    branch: String,
) -> Result<BranchDescriptionDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| session.write.read_branch_description(&branch))
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
