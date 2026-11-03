export const SETTINGS_SECTIONS = [
  { key: "startup", label: "启动" },
  { key: "appearance", label: "外观" },
  { key: "keybindings", label: "快捷键" },
  { key: "terminal", label: "终端" },
  { key: "tools", label: "对比工具" },
  { key: "git-config", label: "Git配置" },
  { key: "about", label: "关于" },
] as const;

export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number]["key"];
