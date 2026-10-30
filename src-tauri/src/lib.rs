mod app;

use std::sync::Arc;

use app::commands;
use app::AppState;
use tauri::{Manager, WebviewWindow, WindowEvent};

/// 旧配置只存过尺寸：最大化关窗会把全屏尺寸当成普通尺寸存下来，
/// 下次启动就成了“看起来全屏、其实没最大化”的窗口。这类尺寸不再作为普通尺寸恢复。
fn legacy_fullscreen_size(
    window: &WebviewWindow,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<(u32, u32)> {
    let (Some(width), Some(height)) = (width, height) else {
        return None;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return Some((width, height));
    };
    let Ok(scale) = window.scale_factor() else {
        return Some((width, height));
    };
    let area = monitor.work_area().size;
    let area_width = (area.width as f64 / scale).round() as i64;
    let area_height = (area.height as f64 / scale).round() as i64;
    // 最大化窗口的客户区宽度等于工作区宽度，高度还要减去标题栏与边框，
    // 所以“等宽 + 略矮”即判定为当年最大化留下的尺寸。
    let looks_maximized = width as i64 - area_width <= 2
        && area_width - width as i64 <= 2
        && area_height - height as i64 >= 0
        && area_height - height as i64 <= 80;
    (!looks_maximized).then_some((width, height))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = Arc::new(AppState::new(app.handle())?);
            let settings = state.settings().unwrap_or_default();
            app.manage(Arc::clone(&state));

            if let Some(window) = app.get_webview_window("main") {
                // 显示前先定好尺寸：窗口在配置里是隐藏的，用户看不到默认尺寸到目标尺寸的过渡。
                // Windows 会按窗口类“上一次的摆放”把新窗口直接恢复成最大化，
                // 所以启动时先取消最大化，再套用保存的普通尺寸。
                let _ = window.unmaximize();
                if let Some((width, height)) =
                    legacy_fullscreen_size(&window, settings.window_width, settings.window_height)
                {
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                }
                // 前端脚本异常时兜底显示，避免窗口永远隐藏。
                let fallback = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if matches!(fallback.is_visible(), Ok(false)) {
                        let _ = fallback.show();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let Some(state) = window.try_state::<Arc<AppState>>() else {
                    return;
                };
                // 关闭窗口前结束终端子进程，避免 LazyGit/Shell 残留成孤儿。
                state.terminals.close_all();
                if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                    let logical = size.to_logical::<u32>(scale);
                    let maximized = window.is_maximized().unwrap_or(false);
                    state.save_window_geometry(logical.width, logical.height, maximized);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::open_feedback_issue,
            commands::terminal_capabilities,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_resize,
            commands::terminal_close,
            commands::load_settings,
            commands::save_settings,
            commands::remember_repository,
            commands::forget_recent_repository,
            commands::startup_repository,
            commands::open_repository,
            commands::close_repository,
            commands::ui_ready,
            commands::repository_state,
            commands::read_graph_page,
            commands::read_graph_page_around,
            commands::read_commit,
            commands::branches_containing,
            commands::commit_branch_context,
            commands::read_file_diff,
            commands::compare_commits,
            commands::compare_file_diff,
            commands::search,
            commands::cancel_search,
            commands::launch_external_diff,
            commands::validate_write,
            commands::execute_write,
            commands::inspect_interruption,
            commands::workspace_status,
            commands::staging_status,
            commands::read_staging_diff,
            commands::read_branch_description,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Git Graph 失败");
}
