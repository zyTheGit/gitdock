import type { ThemedToken } from "shiki";
import type { BlameLineDto } from "../../shared/types";
import { highlightLines, MAX_HIGHLIGHT_LINES, resolveLanguage, type SyntaxTheme } from "../diff/highlightShiki";

/** 分组着色可用的色数：与图谱泳道令牌一一对应。 */
export const BLAME_TONE_COUNT = 8;

/**
 * 按行构造 Shiki token：把整份内容拼接后一次 tokenize（跨行语法如块注释、
 * 模板字符串才能正确着色），行数与原行数不一致或高亮失败时返回 null，
 * 调用方退回纯文本。
 */
export async function buildBlameTokens(
  contents: string[],
  language: string | undefined,
  theme: SyntaxTheme,
): Promise<ThemedToken[][] | null> {
  if (contents.length === 0 || contents.length > MAX_HIGHLIGHT_LINES) {
    return null;
  }
  const lang = resolveLanguage(language);
  if (!lang) {
    return null;
  }
  try {
    const tokens = await highlightLines(contents.join("\n"), lang, theme);
    return tokens.length === contents.length ? tokens : null;
  } catch {
    // 高亮引擎不可用时静默降级为纯文本，不影响 Blame 数据本身。
    return null;
  }
}

function toneOf(oid: string): number {
  // FNV-1a 的 32 位变体：对 OID 十六进制串足够分散，且不依赖提交先后。
  let hash = 0x811c9dc5;
  for (let i = 0; i < oid.length; i += 1) {
    hash ^= oid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % BLAME_TONE_COUNT;
}

/**
 * 每一行的分组色号（0 起）：连续同提交的行同色；相邻两组撞色时顺移一位，
 * 保证相邻分组始终可区分。
 */
export function blameTones(lines: BlameLineDto[]): number[] {
  const tones = new Array<number>(lines.length);
  let previousOid: string | null = null;
  let tone = 0;
  lines.forEach((line, index) => {
    if (line.oid !== previousOid) {
      const next = toneOf(line.oid);
      tone = previousOid !== null && next === tone ? (next + 1) % BLAME_TONE_COUNT : next;
      previousOid = line.oid;
    }
    tones[index] = tone;
  });
  return tones;
}
