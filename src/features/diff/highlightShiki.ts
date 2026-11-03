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

const THEME_NAMES = { light: "github-light", dark: "github-dark" } as const;
export type SyntaxTheme = keyof typeof THEME_NAMES;
export const MAX_HIGHLIGHT_LINES = 2000;

async function createHighlighter(): Promise<HighlighterCore> {
  const [core, engine, lightTheme, darkTheme, langs] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/oniguruma"),
    import("shiki/themes/github-light.mjs"),
    import("shiki/themes/github-dark.mjs"),
    Promise.all(Object.values(LANGS).map(async (load) => (await load()).default)),
  ]);
  return core.createHighlighterCore({
    themes: [lightTheme.default, darkTheme.default],
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

/* ------------------------------ token 行级 LRU 缓存 ------------------------------ */

/**
 * 行级 token 缓存的条目上限（LRU 淘汰）。
 *
 * 取 4000 的取舍：diff 的上下文行与样板行（import、常见包裹代码等）
 * 在不同提交、不同文件之间重复率高，行级条目天然跨块去重，4000 条
 * 独立行约可覆盖十几个大文件 diff 的独特行集合，保证「来回切换视图 /
 * 切回已看过的文件」等高频场景稳定命中；单条目仅为「一行文本键 + 该行
 * token 数组」，估算整体内存在 MB 量级，长时间浏览也不至于无界增长。
 */
const TOKEN_CACHE_MAX_ENTRIES = 4000;

/**
 * 单行文本超过该长度时不进缓存：超长行（如打包产物）作为键的字符串
 * 复制成本与条目体积都偏大，缓存性价比低；其所在块退化为与现状一致
 * 的整块 tokenize，行为不劣化。
 */
const TOKEN_CACHE_MAX_LINE_LENGTH = 2000;

/**
 * 行级 token 缓存，键为 `${lang}\0${theme}\0${行文本}`：
 * - lang / theme 均为受控短字符集且不含 \0，分隔符无歧义；行文本中
 *   即便出现 \0，因前两个分隔位固定，键也不会碰撞；
 * - 选复合键而非嵌套 Map：LRU 只需管理单层结构，查询少两次间接跳转，
 *   代价是每行一次短字符串拼接，相对 tokenize 的开销可忽略。
 */
const tokenCache = new Map<string, ThemedToken[]>();

function lineCacheKey(lang: string, theme: SyntaxTheme, line: string): string {
  return `${lang}\0${theme}\0${line}`;
}

/** 查询并提权：Map 按插入序迭代，delete + set 把命中条目移到末尾。 */
function getCachedLineTokens(key: string): ThemedToken[] | undefined {
  const cached = tokenCache.get(key);
  if (cached !== undefined) {
    tokenCache.delete(key);
    tokenCache.set(key, cached);
  }
  return cached;
}

/** 写入缓存；超过条目上限时按 Map 迭代序删除最旧（最不可能再命中）的条目。 */
function setCachedLineTokens(key: string, tokens: ThemedToken[]): void {
  tokenCache.delete(key);
  tokenCache.set(key, tokens);
  if (tokenCache.size > TOKEN_CACHE_MAX_ENTRIES) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) {
      tokenCache.delete(oldest);
    }
  }
}

/**
 * 尝试整块命中：所有行都已有缓存条目时按行拼装结果直接返回，跳过同步
 * tokenize（Oniguruma 引擎下 2000 行量级可阻塞主线程几十至几百 ms）。
 * 返回 null 表示存在未命中行，需要整块 tokenize。
 */
function tryAssemblyFromCache(
  lines: string[],
  lang: string,
  theme: SyntaxTheme,
): ThemedToken[][] | null {
  const result: ThemedToken[][] = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > TOKEN_CACHE_MAX_LINE_LENGTH) {
      return null;
    }
    const cached = getCachedLineTokens(lineCacheKey(lang, theme, line));
    if (cached === undefined) {
      return null;
    }
    result[i] = cached;
  }
  return result;
}

/**
 * tokenize 结果按行写入缓存。仅当返回行数与输入行数一致时写入，防御
 * shiki 对空输入、尾随换行等边界返回行数不一致导致缓存错位。
 */
function cacheTokenizeResult(
  lines: string[],
  tokens: ThemedToken[][],
  lang: string,
  theme: SyntaxTheme,
): void {
  if (tokens.length !== lines.length) {
    return;
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length <= TOKEN_CACHE_MAX_LINE_LENGTH) {
      setCachedLineTokens(lineCacheKey(lang, theme, lines[i]), tokens[i]);
    }
  }
}

/**
 * 按行切分后高亮：shiki 逐行返回 token，行序与输入一致。失败时抛出，由调用方降级。
 *
 * 内置行级 LRU 缓存：全部行命中时直接拼装返回、跳过 tokenize；存在
 * 未命中行时仍整块 tokenize（跨行语法结构如块注释、模板字符串的高亮
 * 与无缓存时完全一致），并把结果逐行写入缓存供后续命中。
 */
export async function highlightLines(
  text: string,
  lang: string,
  theme: SyntaxTheme,
): Promise<ThemedToken[][]> {
  const lines = text.split("\n");
  const assembled = tryAssemblyFromCache(lines, lang, theme);
  if (assembled) {
    return assembled;
  }
  const highlighter = await getHighlighter();
  const tokens = highlighter.codeToTokens(text, { lang, theme: THEME_NAMES[theme] }).tokens;
  cacheTokenizeResult(lines, tokens, lang, theme);
  return tokens;
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
