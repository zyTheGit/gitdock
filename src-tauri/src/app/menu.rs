//! 应用菜单（ADR-0012，2026-11-05 修订）：仅 macOS 保留原生应用菜单；
//! Windows/Linux 不安装窗口菜单——原生菜单独占标题栏下方的独立一行，
//! 且不随应用深色主题变色，用户裁决移除，设置入口改由顶栏按钮与快捷键承载。
//! 菜单事件经 `app://menu` 发给前端。

use tauri::{AppHandle, Emitter};

/// 菜单事件通道：payload 为动作标识（settings / open_repository / about）。
pub const MENU_EVENT: &str = "app://menu";

pub const ID_SETTINGS: &str = "menu:settings";
pub const ID_OPEN_REPOSITORY: &str = "menu:open_repository";
pub const ID_ABOUT: &str = "menu:about";

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

/// macOS 应用菜单文案；`language` 为 `Some("en")` 时英文，其余（含跟随系统）按中文兜底。
#[cfg(target_os = "macos")]
struct Labels {
    app: &'static str,
    file: &'static str,
    about: &'static str,
    settings: &'static str,
    quit: &'static str,
    open_repository: &'static str,
}

#[cfg(target_os = "macos")]
fn labels(language: Option<&str>) -> Labels {
    if language == Some("en") {
        Labels {
            app: "GitDock",
            file: "File",
            about: "About GitDock",
            settings: "Settings…",
            quit: "Quit GitDock",
            open_repository: "Open Repository…",
        }
    } else {
        Labels {
            app: "GitDock",
            file: "文件",
            about: "关于 GitDock",
            settings: "设置…",
            quit: "退出 GitDock",
            open_repository: "打开仓库…",
        }
    }
}

/// 构建并安装 macOS 应用菜单；语言切换后调用以重建文案。
/// 菜单保持最小：应用菜单（关于 / 设置 / 退出）+ 文件（打开仓库）。
#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle, language: Option<&str>) -> tauri::Result<()> {
    let l = labels(language);

    let settings = MenuItem::with_id(app, ID_SETTINGS, l.settings, true, Some("CmdOrCtrl+,"))?;
    let open_repository = MenuItem::with_id(
        app,
        ID_OPEN_REPOSITORY,
        l.open_repository,
        true,
        None::<&str>,
    )?;
    let about = MenuItem::with_id(app, ID_ABOUT, l.about, true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some(l.quit))?;

    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;

    // macOS 第一个子菜单是应用菜单：关于 / 设置 / 退出放这里，文件只保留打开仓库。
    let app_menu = Submenu::with_items(
        app,
        l.app,
        true,
        &[&about, &sep_b, &settings, &sep_a, &quit],
    )?;
    let file = Submenu::with_items(app, l.file, true, &[&open_repository])?;
    let menu = Menu::with_items(app, &[&app_menu, &file])?;
    app.set_menu(menu)?;

    Ok(())
}

/// Windows/Linux：不安装窗口菜单（ADR-0012 修订）。
/// 设置入口为顶栏按钮与 `Ctrl+,`；关于在设置弹窗的「关于」分区。
#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle, _language: Option<&str>) -> tauri::Result<()> {
    Ok(())
}

/// 菜单事件 → 前端动作；未知 id（含预定义项）直接忽略。仅 macOS 会触发。
pub fn on_event(app: &AppHandle, event: &tauri::menu::MenuEvent) {
    let action = match event.id().as_ref() {
        ID_SETTINGS => "settings",
        ID_OPEN_REPOSITORY => "open_repository",
        ID_ABOUT => "about",
        _ => return,
    };
    let _ = app.emit(MENU_EVENT, action);
}
