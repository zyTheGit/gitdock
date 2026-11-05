//! 应用菜单（ADR-0012）：设置入口统一到菜单栏，菜单事件经 `app://menu` 发给前端。
//!
//! 菜单保持最小：文件（打开仓库 / 设置 / 退出）+ 帮助（关于）。
//! 终端、命令日志已有底部面板与状态栏入口；快捷键、反馈、检查更新分别在设置分区与
//! 关于弹窗内提供，不再放进菜单，避免菜单变成设置的第二入口。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter};

/// 菜单事件通道：payload 为动作标识（settings / open_repository / about）。
pub const MENU_EVENT: &str = "app://menu";

pub const ID_SETTINGS: &str = "menu:settings";
pub const ID_OPEN_REPOSITORY: &str = "menu:open_repository";
pub const ID_ABOUT: &str = "menu:about";

struct Labels {
    /// 仅 macOS 应用菜单使用；Windows/Linux 编译时该字段不参与读取。
    #[allow(dead_code)]
    app: &'static str,
    file: &'static str,
    help: &'static str,
    about: &'static str,
    settings: &'static str,
    quit: &'static str,
    open_repository: &'static str,
}

/// 菜单文案：`language` 为 `Some("en")` 时英文，其余（含跟随系统）按中文兜底。
fn labels(language: Option<&str>) -> Labels {
    if language == Some("en") {
        Labels {
            app: "GitDock",
            file: "File",
            help: "Help",
            about: "About GitDock",
            settings: "Settings…",
            quit: "Quit GitDock",
            open_repository: "Open Repository…",
        }
    } else {
        Labels {
            app: "GitDock",
            file: "文件",
            help: "帮助",
            about: "关于 GitDock",
            settings: "设置…",
            quit: "退出 GitDock",
            open_repository: "打开仓库…",
        }
    }
}

/// 构建并安装应用菜单；语言切换后调用以重建文案。
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

    #[cfg(target_os = "macos")]
    {
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
    }
    #[cfg(not(target_os = "macos"))]
    {
        let file = Submenu::with_items(
            app,
            l.file,
            true,
            &[&open_repository, &sep_b, &settings, &sep_a, &quit],
        )?;
        let help = Submenu::with_items(app, l.help, true, &[&about])?;
        let menu = Menu::with_items(app, &[&file, &help])?;
        app.set_menu(menu)?;
    }

    Ok(())
}

/// 菜单事件 → 前端动作；未知 id（含预定义项）直接忽略。
pub fn on_event(app: &AppHandle, event: &tauri::menu::MenuEvent) {
    let action = match event.id().as_ref() {
        ID_SETTINGS => "settings",
        ID_OPEN_REPOSITORY => "open_repository",
        ID_ABOUT => "about",
        _ => return,
    };
    let _ = app.emit(MENU_EVENT, action);
}
