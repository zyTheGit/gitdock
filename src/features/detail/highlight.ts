import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedToken,
} from "shiki";
import type { HunkTokens, TokenNode } from "react-diff-view";

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

const THEME = "github-dark";
const MAX_HIGHLIGHT_LINES = 2000;

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

function styleClass(token: ThemedToken | undefined): string | null {
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

/* ------------------------------ hunk 解析 ------------------------------ */

export interface DiffChangeLike {
  type: string;
  content: string;
  /** normal 变更使用 oldLineNumber/newLineNumber；insert/delete 使用 lineNumber。 */
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function oldLineOf(change: DiffChangeLike): number | undefined {
  if (change.type === "normal") {
    return change.oldLineNumber;
  }
  return change.type === "delete" ? change.lineNumber : undefined;
}

function newLineOf(change: DiffChangeLike): number | undefined {
  if (change.type === "normal") {
    return change.newLineNumber;
  }
  return change.type === "insert" ? change.lineNumber : undefined;
}

export interface DiffHunkLike {
  changes: DiffChangeLike[];
}

type MarkRange = [start: number, end: number];

interface SideMarks {
  old: Map<number, MarkRange[]>;
  new: Map<number, MarkRange[]>;
}

function addMark(map: Map<number, MarkRange[]>, line: number | undefined, range: MarkRange) {
  if (!line) {
    return;
  }
  const list = map.get(line);
  if (list) {
    list.push(range);
  } else {
    map.set(line, [range]);
  }
}

/** 对相邻的删除/新增行做字符级公共前后缀裁剪，得到行内 diff 标记。 */
function collectMarks(hunks: DiffHunkLike[]): SideMarks {
  const marks: SideMarks = { old: new Map(), new: new Map() };
  for (const hunk of hunks) {
    const changes = hunk.changes;
    let index = 0;
    while (index < changes.length) {
      if (changes[index].type !== "delete") {
        index += 1;
        continue;
      }
      const deletes: DiffChangeLike[] = [];
      while (index < changes.length && changes[index].type === "delete") {
        deletes.push(changes[index]);
        index += 1;
      }
      const inserts: DiffChangeLike[] = [];
      while (index < changes.length && changes[index].type === "insert") {
        inserts.push(changes[index]);
        index += 1;
      }
      const pairs = Math.min(deletes.length, inserts.length);
      for (let i = 0; i < pairs; i += 1) {
        const oldText = deletes[i].content;
        const newText = inserts[i].content;
        const max = Math.min(oldText.length, newText.length);
        let prefix = 0;
        while (prefix < max && oldText[prefix] === newText[prefix]) {
          prefix += 1;
        }
        let suffix = 0;
        while (
          suffix < max - prefix &&
          oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
        ) {
          suffix += 1;
        }
        if (oldText.length - prefix - suffix > 0) {
          addMark(marks.old, oldLineOf(deletes[i]), [prefix, oldText.length - suffix]);
        }
        if (newText.length - prefix - suffix > 0) {
          addMark(marks.new, newLineOf(inserts[i]), [prefix, newText.length - suffix]);
        }
      }
    }
  }
  return marks;
}

interface SideLine {
  line: number;
  text: string;
}

function collectSide(hunks: DiffHunkLike[], side: "old" | "new"): SideLine[] {
  const lines: SideLine[] = [];
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const isContext = change.type === "normal";
      if (side === "old" && (isContext || change.type === "delete")) {
        const line = oldLineOf(change);
        if (line) {
          lines.push({ line, text: change.content });
        }
      }
      if (side === "new" && (isContext || change.type === "insert")) {
        const line = newLineOf(change);
        if (line) {
          lines.push({ line, text: change.content });
        }
      }
    }
  }
  return lines;
}

/* ------------------------------ token 构造 ------------------------------ */

function tokenNodes(
  text: string,
  themeTokens: ThemedToken[] | undefined,
  marks: MarkRange[],
): TokenNode[] {
  if (!text) {
    return [];
  }
  const tokens: ThemedToken[] =
    themeTokens && themeTokens.length > 0
      ? themeTokens
      : [{ content: text } as ThemedToken];

  const boundaries = new Set<number>([0, text.length]);
  let offset = 0;
  for (const token of tokens) {
    offset += token.content.length;
    if (offset > 0 && offset < text.length) {
      boundaries.add(offset);
    }
  }
  for (const [start, end] of marks) {
    if (start > 0 && start < text.length) {
      boundaries.add(start);
    }
    if (end > 0 && end < text.length) {
      boundaries.add(end);
    }
  }
  const points = [...boundaries].filter((point) => point >= 0 && point <= text.length);
  points.sort((a, b) => a - b);
  if (points[0] !== 0) {
    points.unshift(0);
  }
  if (points[points.length - 1] !== text.length) {
    points.push(text.length);
  }

  const nodes: TokenNode[] = [];
  let tokenIndex = 0;
  let tokenStart = 0;
  let group: { marked: boolean; children: TokenNode[] } | null = null;

  const flush = () => {
    if (!group) {
      return;
    }
    if (group.children.length > 0) {
      if (group.marked) {
        nodes.push({ type: "edit", children: group.children });
      } else {
        nodes.push(...group.children);
      }
    }
    group = null;
  };

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) {
      continue;
    }
    while (
      tokenIndex < tokens.length - 1 &&
      tokenStart + tokens[tokenIndex].content.length <= start
    ) {
      tokenStart += tokens[tokenIndex].content.length;
      tokenIndex += 1;
    }
    const token = tokens[tokenIndex];
    const marked = marks.some(([from, to]) => from <= start && end <= to);
    const className = styleClass(token);
    const value = text.slice(start, end);
    if (!value) {
      continue;
    }
    const node: TokenNode = className
      ? { type: "code", className, value }
      : { type: "text", value };
    if (!group || group.marked !== marked) {
      flush();
      group = { marked, children: [] };
    }
    group.children.push(node);
  }
  flush();
  return nodes;
}

export interface DiffTokenResult {
  tokens: HunkTokens;
  highlighted: boolean;
}

function resolveLanguage(language: string | undefined): string | null {
  if (!language) {
    return null;
  }
  const key = language.trim().toLowerCase();
  const resolved = ALIASES[key] ?? (LANGS.includes(key as (typeof LANGS)[number]) ? key : null);
  return resolved;
}

/**
 * 将 hunk 转为 react-diff-view 所需的按行 token（含行内 diff 标记）。
 * 语言未知或行数过多时仍返回 token（仅行内标记），不阻塞文本展示。
 */
export async function buildDiffTokens(
  hunks: DiffHunkLike[],
  language: string | undefined,
): Promise<DiffTokenResult> {
  const marks = collectMarks(hunks);
  const oldLines = collectSide(hunks, "old");
  const newLines = collectSide(hunks, "new");
  const totalLines = oldLines.length + newLines.length;
  const lang = totalLines <= MAX_HIGHLIGHT_LINES ? resolveLanguage(language) : null;

  let oldHighlighted: ThemedToken[][] | null = null;
  let newHighlighted: ThemedToken[][] | null = null;

  if (lang) {
    try {
      const highlighter = await getHighlighter();
      if (oldLines.length > 0) {
        oldHighlighted = highlighter.codeToTokens(oldLines.map((line) => line.text).join("\n"), {
          lang: lang as BundledLanguage,
          theme: THEME,
        }).tokens;
      }
      if (newLines.length > 0) {
        newHighlighted = highlighter.codeToTokens(newLines.map((line) => line.text).join("\n"), {
          lang: lang as BundledLanguage,
          theme: THEME,
        }).tokens;
      }
    } catch {
      oldHighlighted = null;
      newHighlighted = null;
    }
  }

  const toSide = (
    lines: SideLine[],
    highlighted: ThemedToken[][] | null,
    side: Map<number, MarkRange[]>,
  ): TokenNode[][] => {
    const result: TokenNode[][] = [];
    lines.forEach((line, index) => {
      result[line.line - 1] = tokenNodes(
        line.text,
        highlighted ? highlighted[index] : undefined,
        side.get(line.line) ?? [],
      );
    });
    return result;
  };

  return {
    tokens: {
      old: toSide(oldLines, oldHighlighted, marks.old),
      new: toSide(newLines, newHighlighted, marks.new),
    },
    highlighted: Boolean(oldHighlighted || newHighlighted),
  };
}
