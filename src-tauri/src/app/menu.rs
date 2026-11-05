//! 应用菜单（ADR-0012）：设置入口统一到菜单栏，菜单事件经 `app://menu` 发给前端。
//!
//! 菜单结构按平台分派：macOS 第一个子菜单为应用菜单（关于/检查更新/设置/退出），
//! Windows/Linux 为窗口菜单栏（文件/视图/帮助）。菜单文案使用 Rust 侧静态表，
//! 语言切换后由 `set_language` 调用 `install` 重建。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter};

/// 菜单事件通道：payload 为动作标识（settings / open_repository / ...）。
pub const MENU_EVENT: &str = "app://menu";

pub const ID_SETTINGS: &str = "menu:settings";
pub const ID_OPEN_REPOSITORY: &str = "menu:open_repository";
pub const ID_TERMINAL: &str = "menu:terminal";
pub const ID_COMMAND_LOG: &str = "menu:command_log";
pub const ID_FEEDBACK: &str = "menu:feedback";
pub const ID_SHORTCUTS: &str = "menu:shortcuts";
pub const ID_ABOUT: &str = "menu:about";
pub const ID_CHECK_UPDATE: &str = "menu:check_update";

struct Labels {
    /// 仅 macOS 应用菜单使用；Windows/Linux 编译时该字段不参与读取。
    #[allow(dead_code)]
    app: &'static str,
    file: &'static str,
    view: &'static str,
    help: &'static str,
    about: &'static str,
    check_update: &'static str,
    settings: &'static str,
    quit: &'static str,
    open_repository: &'static str,
    terminal: &'static str,
    command_log: &'static str,
    feedback: &'static str,
    shortcuts: &'static str,
}

/// 菜单文案：`language` 为 `Some("en")` 时英文，其余（含跟随系统）按中文兜底。
fn labels(language: Option<&str>) -> Labels {
    if language == Some("en") {
        Labels {
            app: "GitDock",
            file: "File",
            view: "View",
            help: "Help",
            about: "About GitDock",
            check_update: "Check for Updates…",
            settings: "Settings…",
            quit: "Quit GitDock",
            open_repository: "Open Repository…",
            terminal: "Terminal",
            command_log: "Command Log",
            feedback: "Send Feedback…",
            shortcuts: "Keyboard Shortcuts",
        }
    } else {
        Labels {
            app: "GitDock",
            file: "文件",
            view: "视图",
            help: "帮助",
            about: "关于 GitDock",
            check_update: "检查更新…",
            settings: "设置…",
            quit: "退出 GitDock",
            open_repository: "打开仓库…",
            terminal: "终端",
            command_log: "命令日志",
            feedback: "发送反馈…",
            shortcuts: "快捷键",
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
    let terminal = MenuItem::with_id(app, ID_TERMINAL, l.terminal, true, None::<&str>)?;
    let command_log = MenuItem::with_id(app, ID_COMMAND_LOG, l.command_log, true, None::<&str>)?;
    let feedback = MenuItem::with_id(app, ID_FEEDBACK, l.feedback, true, None::<&str>)?;
    let shortcuts = MenuItem::with_id(app, ID_SHORTCUTS, l.shortcuts, true, None::<&str>)?;
    let about = MenuItem::with_id(app, ID_ABOUT, l.about, true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, ID_CHECK_UPDATE, l.check_update, true, None::<&str>)?;
    let quit = PredefinedMenuItem::quit(app, Some(l.quit))?;

    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;
    let sep_c = PredefinedMenuItem::separator(app)?;

    let view = Submenu::with_items(app, l.view, true, &[&terminal, &command_log])?;
    let help = Submenu::with_items(
        app,
        l.help,
        true,
        &[&check_update, &shortcuts, &feedback, &sep_a, &about],
    )?;

    #[cfg(target_os = "macos")]
    {
        // macOS 第一个子菜单显示为应用菜单：设置与退出放在这里，File 只保留打开仓库。
        let app_menu = Submenu::with_items(
            app,
            l.app,
            true,
            &[&about, &check_update, &sep_b, &settings, &sep_c, &quit],
        )?;
        let file = Submenu::with_items(app, l.file, true, &[&open_repository])?;
        let menu = Menu::with_items(app, &[&app_menu, &file, &view, &help])?;
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let file = Submenu::with_items(
            app,
            l.file,
            true,
            &[&open_repository, &sep_b, &settings, &sep_c, &quit],
        )?;
        let menu = Menu::with_items(app, &[&file, &view, &help])?;
        app.set_menu(menu)?;
    }

    Ok(())
}

/// 菜单事件 → 前端动作；未知 id（含预定义项）直接忽略。
pub fn on_event(app: &AppHandle, event: &tauri::menu::MenuEvent) {
    let action = match event.id().as_ref() {
        ID_SETTINGS => "settings",
        ID_OPEN_REPOSITORY => "open_repository",
        ID_TERMINAL => "terminal",
        ID_COMMAND_LOG => "command_log",
        ID_FEEDBACK => "feedback",
        ID_SHORTCUTS => "shortcuts",
        ID_ABOUT => "about",
        ID_CHECK_UPDATE => "check_update",
        _ => return,
    };
    let _ = app.emit(MENU_EVENT, action);
}
