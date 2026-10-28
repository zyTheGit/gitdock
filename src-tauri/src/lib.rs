mod app;

use std::sync::Arc;

use app::commands;
use app::AppState;
use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = Arc::new(AppState::new(app.handle())?);
            let settings = state.settings().unwrap_or_default();
            app.manage(Arc::clone(&state));

            if let Some(window) = app.get_webview_window("main") {
                if let (Some(width), Some(height)) = (settings.window_width, settings.window_height)
                {
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let Some(state) = window.try_state::<Arc<AppState>>() else {
                    return;
                };
                if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                    let logical = size.to_logical::<u32>(scale);
                    state.save_window_size(logical.width, logical.height);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::load_settings,
            commands::save_settings,
            commands::remember_repository,
            commands::startup_repository,
            commands::open_repository,
            commands::close_repository,
            commands::repository_state,
            commands::read_graph_page,
            commands::read_graph_page_around,
            commands::read_commit,
            commands::branches_containing,
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
            commands::read_branch_description,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Git Graph 失败");
}
