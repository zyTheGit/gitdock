import type { HighlighterCore, ThemedToken } from "shiki/core";

// `createHighlighter` 会把 shiki 内置的全部语法（约 250 个语言模块）一起打进产物；
// 这里只按需加载 MVP 常见语言，未知语言直接降级为纯文本，不阻塞 diff 展示。
const LANGS = {
  ts: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  js: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  sh: () => import("shiki/langs/shellscript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};

const LANG_KEYS = new Set(Object.keys(LANGS));

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

const THEME = "github-dark";
export const MAX_HIGHLIGHT_LINES = 2000;

async function createHighlighter(): Promise<HighlighterCore> {
  const [core, engine, theme, langs] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/oniguruma"),
    import("shiki/themes/github-dark.mjs"),
    Promise.all(Object.values(LANGS).map(async (load) => (await load()).default)),
  ]);
  return core.createHighlighterCore({
    themes: [theme.default],
    langs,
    engine: engine.createOnigurumaEngine(import("shiki/wasm")),
  });
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterFailed = false;

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterFailed) {
    return Promise.reject(new Error("highlighter unavailable"));
  }
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter().catch((err) => {
      highlighterFailed = true;
      throw err;
    });
  }
  return highlighterPromise;
}

export function resolveLanguage(language: string | undefined): string | null {
  if (!language) {
    return null;
  }
  const key = language.trim().toLowerCase();
  return ALIASES[key] ?? (LANG_KEYS.has(key) ? key : null);
}

/** 按行切分后高亮：shiki 逐行返回 token，行序与输入一致。失败时抛出，由调用方降级。 */
export async function highlightLines(
  text: string,
  lang: string,
): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  return highlighter.codeToTokens(text, { lang, theme: THEME }).tokens;
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
