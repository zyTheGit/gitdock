import { useCallback, useEffect, useState } from "react";
import type { SettingsSectionKey } from "../features/settings/settingsSections";
import { useAppMenu } from "./useAppMenu";

interface SettingsEntryParams {
  onOpenRepository: () => void;
}

/**
 * 应用入口接线（ADR-0012，2026-11-05 修订）：顶栏设置按钮与 Ctrl/Cmd+, 打开设置；
 * macOS 原生菜单事件仍经 useAppMenu 接入，「关于」直达设置弹窗的关于分区。
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
    onOpenAbout: () => openSettings("about"),
  });

  // 顶栏按钮之外的键盘快捷方式：Ctrl/Cmd + 逗号。
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