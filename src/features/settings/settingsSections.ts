import type { IconName } from "../../assets/icons";

/** 分区导航：labelKey 存 i18n 全限定 key，icon 为 assets/icons 注册名；渲染处（SettingsNav）用 t() 取分区名文案。 */
export const SETTINGS_SECTIONS = [
  { key: "startup", labelKey: "settings.sectionStartup", icon: "rocket" as IconName },
  { key: "appearance", labelKey: "settings.sectionAppearance", icon: "palette" as IconName },
  { key: "keybindings", labelKey: "settings.sectionKeybindings", icon: "keyboard" as IconName },
  { key: "terminal", labelKey: "settings.sectionTerminal", icon: "terminal" as IconName },
  { key: "tools", labelKey: "settings.sectionTools", icon: "splitView" as IconName },
  { key: "git-config", labelKey: "settings.sectionGitConfig", icon: "gitBranch" as IconName },
  { key: "about", labelKey: "settings.sectionAbout", icon: "info" as IconName },
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"];
