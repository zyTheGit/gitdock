import { useCallback, useEffect, useState } from "react";
import type { SettingsSectionKey } from "../features/settings/settingsSections";
import { useAppMenu } from "./useAppMenu";

interface SettingsEntryParams {
  onOpenRepository: () => void;
}

/**
 * 应用入口接线（ADR-0012）：菜单与 Ctrl/Cmd+, 打开设置，「关于」打开独立弹窗，
 * 避免菜单项全部落到设置弹框。
 */
export function useSettingsEntry(params: SettingsEntryParams) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionKey>("startup");
  const [aboutOpen, setAboutOpen] = useState(false);

  const openSettings = useCallback((next: SettingsSectionKey = "startup") => {
    setSection(next);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => setOpen(false), []);
  const openAbout = useCallback(() => setAboutOpen(true), []);
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  useAppMenu({
    onOpenSettings: openSettings,
    onOpenRepository: params.onOpenRepository,
    onOpenAbout: openAbout,
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

  return { open, section, openSettings, closeSettings, aboutOpen, openAbout, closeAbout };
}