import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { SettingsSectionKey } from "../features/settings/settingsSections";

/** Rust 菜单事件（app://menu）的动作标识，与 src-tauri/src/app/menu.rs 保持一致。 */
export type AppMenuAction =
  | "settings"
  | "open_repository"
  | "terminal"
  | "command_log"
  | "feedback"
  | "shortcuts"
  | "about"
  | "check_update";

export interface AppMenuHandlers {
  onOpenSettings: (section: SettingsSectionKey) => void;
  onOpenRepository: () => void;
  onToggleTerminal: () => void;
  onOpenCommandLog: () => void;
  onCheckUpdate: () => void;
}

/**
 * 应用菜单事件接线（ADR-0012）：Rust 菜单只发动作标识，前端分发到既有状态 setter。
 * handlers 放在 ref 中，避免函数身份变化导致反复监听/退订。
 */
export function useAppMenu(handlers: AppMenuHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AppMenuAction>("app://menu", (event) => {
      const current = handlersRef.current;
      switch (event.payload) {
        case "settings":
          current.onOpenSettings("startup");
          break;
        case "shortcuts":
          current.onOpenSettings("keybindings");
          break;
        case "about":
        case "feedback":
          current.onOpenSettings("about");
          break;
        case "open_repository":
          current.onOpenRepository();
          break;
        case "terminal":
          current.onToggleTerminal();
          break;
        case "command_log":
          current.onOpenCommandLog();
          break;
        case "check_update":
          current.onCheckUpdate();
          break;
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}