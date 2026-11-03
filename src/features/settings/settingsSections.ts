/** 分区导航：labelKey 存 i18n 全限定 key，渲染处（SettingsNav）用 t() 取分区名文案。 */
export const SETTINGS_SECTIONS = [
  { key: "startup", labelKey: "settings.sectionStartup" },
  { key: "appearance", labelKey: "settings.sectionAppearance" },
  { key: "keybindings", labelKey: "settings.sectionKeybindings" },
  { key: "terminal", labelKey: "settings.sectionTerminal" },
  { key: "tools", labelKey: "settings.sectionTools" },
  { key: "git-config", labelKey: "settings.sectionGitConfig" },
  { key: "about", labelKey: "settings.sectionAbout" },
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"];
