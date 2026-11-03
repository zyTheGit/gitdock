// 平台标识（ADR-0005 前端对应物）：启动时由 AppInfoDto.platform 注入一次，
// 全局只读。OS 不会运行时变化，导出同步 getter 而非 React 状态。
// 平台条件文案（⌘/Ctrl、安装指引等）消费 currentPlatform()；禁用
// navigator.platform / userAgent 嗅探。

export type Platform = "windows" | "macos" | "linux";

let platform: Platform = "windows";

/** App 启动时调用一次（main.tsx 或首个取到 AppInfoDto 的位置）。 */
export function initPlatform(rawPlatform: string): void {
  if (rawPlatform.startsWith("macos")) platform = "macos";
  else if (rawPlatform.startsWith("linux")) platform = "linux";
  else platform = "windows";
}

/** 当前平台；initPlatform 之前默认 windows（主开发平台）。 */
export function currentPlatform(): Platform {
  return platform;
}

/** 平台主修饰键名：macOS 显示 ⌘，其余显示 Ctrl。用于文案拼接。 */
export function primaryModifierLabel(): string {
  return platform === "macos" ? "⌘" : "Ctrl";
}