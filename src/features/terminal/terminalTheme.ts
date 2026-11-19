import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "../../shared/theme";

/** 深色 ANSI 调色板：沿用 xterm 默认值，与 #111318 背景匹配。 */
const DARK_ANSI: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

/** 浅色 ANSI 调色板：亮色系在白底上不可读，改用深色系（参考 VS Code 浅色终端）。 */
const LIGHT_ANSI: ITheme = {
  black: "#000000",
  red: "#cd3131",
  green: "#107c10",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function token(name: string, fallback: string): string {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/**
 * 由当前主题的语义令牌构建 xterm 配色：背景/前景/选区与底部面板保持同一套 CSS 令牌，
 * ANSI 调色板按浅/深各一套。主题切换后重新构建并写回 term.options.theme 即可实时生效。
 */
export function buildTerminalTheme(theme: ResolvedTheme): ITheme {
  const dark = theme === "dark";
  return {
    background: token("--terminal-bg", dark ? "#111318" : "#ffffff"),
    foreground: token("--text", dark ? "#e6e9ef" : "#1d2129"),
    cursor: token("--text", dark ? "#e6e9ef" : "#1d2129"),
    cursorAccent: token("--terminal-bg", dark ? "#111318" : "#ffffff"),
    selectionBackground: token("--diff-selection-bg", dark ? "#35507a" : "#cfe0ff"),
    selectionForeground: token("--diff-selection-text", dark ? "#ffffff" : "#1d2129"),
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
  };
}
