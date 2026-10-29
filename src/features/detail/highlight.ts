import type { HunkTokens, TokenNode } from "react-diff-view";
import type { ThemedToken } from "shiki";
import {
  collectMarks,
  collectSide,
  type DiffHunkLike,
  type MarkRange,
  type SideLine,
} from "./highlightMarks";
import {
  highlightLines,
  MAX_HIGHLIGHT_LINES,
  resolveLanguage,
  styleClass,
} from "./highlightShiki";

export type { DiffChangeLike, DiffHunkLike } from "./highlightMarks";

export interface DiffTokenResult {
  tokens: HunkTokens;
  highlighted: boolean;
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
      if (oldLines.length > 0) {
        oldHighlighted = await highlightLines(
          oldLines.map((line) => line.text).join("\n"),
          lang,
        );
      }
      if (newLines.length > 0) {
        newHighlighted = await highlightLines(
          newLines.map((line) => line.text).join("\n"),
          lang,
        );
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
