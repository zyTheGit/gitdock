import { useCallback, useEffect, useState } from "react";
import type { SettingsSectionKey } from "../features/settings/settingsSections";
import { useAppMenu } from "./useAppMenu";

interface SettingsEntryParams {
  onOpenRepository: () => void;
  onToggleTerminal: () => void;
  onOpenCommandLog: () => void;
  onCheckUpdate: () => void;
}

/**
 * 设置入口与菜单接线（ADR-0012）：菜单与 Ctrl/Cmd+, 都统一走 openSettings，
 * 同时把其余菜单动作分发到既有状态 setter，避免 App 继续膨胀。
 */
export function useSettingsEntry(params: SettingsEntryParams) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionKey>("startup");

  const openSettings = useCallback((next: SettingsSectionKey = "startup") => {
    setSection(next);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => setOpen(false), []);

  useAppMenu({
    onOpenSettings: openSettings,
    onOpenRepository: params.onOpenRepository,
    onToggleTerminal: params.onToggleTerminal,
    onOpenCommandLog: params.onOpenCommandLog,
    onCheckUpdate: params.onCheckUpdate,
  });

  // 菜单栏入口之外的键盘快捷方式：Ctrl/Cmd + 逗号。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSettings]);

  return { open, section, openSettings, closeSettings };
}