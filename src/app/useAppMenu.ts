import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** Rust 菜单事件（app://menu）的动作标识，与 src-tauri/src/app/menu.rs 保持一致。 */
export type AppMenuAction = "settings" | "open_repository" | "about";

export interface AppMenuHandlers {
  onOpenSettings: () => void;
  onOpenRepository: () => void;
  onOpenAbout: () => void;
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
          current.onOpenSettings();
          break;
        case "open_repository":
          current.onOpenRepository();
          break;
        case "about":
          current.onOpenAbout();
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