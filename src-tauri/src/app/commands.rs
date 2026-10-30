//! 受限 Tauri command seam。
//!
//! 约束：前端只能调用这里注册的白名单 command；这里不接受命令字符串、不接受
//! 任意 `.git` 路径，也不向前端暴露 Git 原始对象。只读访问经由 `GitReadModule`，
//! 写操作经由 `GitWriteModule`（内部只调用 Git CLI），二者都按结构化请求工作。

use std::path::PathBuf;
use std::sync::Arc;

use git_core::{
    BranchDescriptionDto, CommitBranchContextDto, CommitDetailDto, CompareResultDto, ErrorCode,
    FileDiffDto, GateReportDto, GraphPageDto, GraphScope, InterruptionDto, Oid, RepoStateDto,
    Result, SearchPageDto, SearchRequest, UserVisibleError, WorkspaceStatusDto, WriteOutcomeDto,
    WriteRequest,
};
use git_read::{detect_git_version, GitReadModule, DEFAULT_PAGE_LIMIT, MINIMUM_GIT_VERSION};
use git_write::GitWriteModule;
use refresh::RefreshReason;
use serde::Serialize;
use tauri::State;

use super::config::SettingsDto;
use super::logging;
use super::state::{AppState, Session};
use super::terminal::{self, TerminalCapabilitiesDto, TerminalEvent};

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

/// 前端完成首帧后再显示主窗口：窗口在配置里保持隐藏，避免启动时先按默认尺寸
/// 出现、再跳成保存的尺寸，以及 WebView2 未绘制前的白底闪帧。
#[tauri::command]
pub fn ui_ready(window: tauri::WebviewWindow) -> Result<()> {
    window.show().map_err(|err| {
        UserVisibleError::new(ErrorCode::Internal, "显示主窗口失败").with_detail(err.to_string())
    })?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn load_settings(state: State<'_, Shared>) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.settings()).await
}

#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    settings: SettingsDto,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        let saved = state.save_settings(settings)?;
        // 监听开关随设置即时生效；仅当仓库已打开时重启。
        if let Ok(repo) = state.with_session(|session| Ok(session.read.path().to_path_buf())) {
            state.restart_watcher(&app, &repo);
        }
        Ok(saved)
    })
    .await
}

#[tauri::command]
pub async fn remember_repository(state: State<'_, Shared>, path: String) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.remember_repository(&PathBuf::from(path))).await
}

/// 仅从最近仓库列表移除展示项，不删除磁盘上的仓库。
#[tauri::command]
pub async fn forget_recent_repository(
    state: State<'_, Shared>,
    path: String,
) -> Result<SettingsDto> {
    let state = Arc::clone(&state);
    blocking(move || state.forget_repository(&path)).await
}

#[tauri::command]
pub fn startup_repository() -> Option<String> {
    // F1 启动传参：取第一个非选项参数，路径校验与打开交给 open_repository。
    std::env::args_os()
        .skip(1)
        .find(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(|arg| arg.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn open_repository(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    path: String,
) -> Result<RepoStateDto> {
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
        let mut state_dto = read.state()?;
        // 写前 Gate 与启动恢复共用同一检测来源，避免只读模块与写模块给出不同中断态。
        state_dto.interruption = write.inspect_interruption()?;
        logging::info(&format!(
            "打开仓库 {}（{}，generation {}）",
            state_dto.path,
            state_dto.object_format.as_str(),
            state_dto.generation
        ));
        // 切换仓库前结束旧终端，避免旧仓库的 LazyGit/Shell 继续运行并改动旧仓库。
        state.terminals.close_all();
        state.replace_session(Some(Session { read, write }))?;
        state.request_refresh(RefreshReason::Manual);
        state.accept_generation(state_dto.generation);
        state.restart_watcher(&app, &open_path);
        Ok(state_dto)
    })
    .await
}

#[tauri::command]
pub async fn close_repository(state: State<'_, Shared>) -> Result<()> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.stop_watcher();
        state.terminals.close_all();
        state.close()?;
        logging::info("关闭仓库");
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn repository_state(state: State<'_, Shared>) -> Result<RepoStateDto> {
    let state = Arc::clone(&state);
    blocking(move || {
        state.with_session(|session| {
            let mut dto = session.read.state()?;
            // 刷新与写前 Gate 必须是同一中断检测来源，否则写后横幅滞后一整个操作。
            dto.interruption = session.write.inspect_interruption()?;
            Ok(dto)
        })
    })
    .await
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
        let outcome = state.with_session(|session| {
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
        })?;
        // 写操作强制失效：先登记新代际，避免监听线程对同一变化重复通知。
        if let Some(generation) = outcome.generation {
            state.request_refresh(RefreshReason::Write);
            state.observe_generation(generation);
            state.accept_generation(generation);
        }
        Ok(outcome)
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
    blocking(move || state.with_session(|session| session.write.read_branch_description(&branch)))
        .await
}

#[tauri::command]
pub fn terminal_capabilities(state: State<'_, Shared>) -> Result<TerminalCapabilitiesDto> {
    terminal::capabilities(&state)
}

/// 工作目录由后端取当前仓库；前端只能选择模式与 PTY 尺寸。
#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    state: State<'_, Shared>,
    mode: String,
    cols: u16,
    rows: u16,
    channel: tauri::ipc::Channel<TerminalEvent>,
) -> Result<u64> {
    terminal::open(&state, &app, &mode, cols, rows, channel)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, Shared>, id: u64, data: String) -> Result<()> {
    terminal::write(&state, id, &data)
}

#[tauri::command]
pub fn terminal_resize(state: State<'_, Shared>, id: u64, cols: u16, rows: u16) -> Result<()> {
    terminal::resize(&state, id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(state: State<'_, Shared>, id: u64) {
    terminal::close(&state, id);
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
