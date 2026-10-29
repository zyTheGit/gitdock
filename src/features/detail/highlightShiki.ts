import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from "shiki";

// 只加载 MVP 常见语言；未知语言直接降级为纯文本，不阻塞 diff 展示。
const LANGS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "html",
  "xml",
  "css",
  "scss",
  "md",
  "rust",
  "python",
  "java",
  "go",
  "c",
  "cpp",
  "sh",
  "yaml",
  "toml",
  "sql",
  "diff",
] as const;

const ALIASES: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  html: "html",
  xml: "xml",
  css: "css",
  scss: "scss",
  less: "css",
  markdown: "md",
  md: "md",
  rust: "rust",
  python: "python",
  py: "python",
  java: "java",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  shell: "sh",
  bash: "sh",
  sh: "sh",
  zsh: "sh",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

export const THEME = "github-dark";
export const MAX_HIGHLIGHT_LINES = 2000;

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterFailed = false;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterFailed) {
    return Promise.reject(new Error("highlighter unavailable"));
  }
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: [...LANGS] }).catch(
      (err) => {
        highlighterFailed = true;
        throw err;
      },
    );
  }
  return highlighterPromise;
}

export function resolveLanguage(language: string | undefined): string | null {
  if (!language) {
    return null;
  }
  const key = language.trim().toLowerCase();
  return ALIASES[key] ?? (LANGS.includes(key as (typeof LANGS)[number]) ? key : null);
}

/** 按行切分后高亮：shiki 逐行返回 token，行序与输入一致。失败时抛出，由调用方降级。 */
export async function highlightLines(
  text: string,
  lang: string,
): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  return highlighter.codeToTokens(text, {
    lang: lang as BundledLanguage,
    theme: THEME,
  }).tokens;
}

/* ------------------------------ 样式类 ------------------------------ */

let styleElement: HTMLStyleElement | null = null;
const styleNames = new Map<string, string>();

function ensureStyleSheet(): CSSStyleSheet | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (!styleElement) {
    styleElement = document.createElement("style");
    styleElement.dataset.shikiDiff = "true";
    document.head.appendChild(styleElement);
  }
  return styleElement.sheet;
}

export function styleClass(token: ThemedToken | undefined): string | null {
  const color = token?.color;
  const fontStyle = token?.fontStyle ?? 0;
  if (!color && !fontStyle) {
    return null;
  }
  const key = `${color ?? ""}|${fontStyle}`;
  const cached = styleNames.get(key);
  if (cached) {
    return cached;
  }
  const suffix = `${(color ?? "none").replace(/[^0-9a-zA-Z]/g, "")}-${fontStyle}`;
  const name = `shiki-${suffix}`;
  styleNames.set(key, name);
  const sheet = ensureStyleSheet();
  if (sheet) {
    const decls = [
      color ? `color:${color}` : "",
      fontStyle & 1 ? "font-style:italic" : "",
      fontStyle & 2 ? "font-weight:600" : "",
      fontStyle & 4 ? "text-decoration:underline" : "",
    ]
      .filter(Boolean)
      .join(";");
    try {
      sheet.insertRule(`.${name}{${decls}}`, sheet.cssRules.length);
    } catch {
      // 样式注入失败时退化为默认颜色，不影响 diff 内容。
    }
  }
  return name;
}
