import type { CommitSummaryDto } from "../../shared/types";

const SUGGESTION_LIMIT = 8;

export interface Suggestion {
  text: string;
  /** 提交说明候选直接带 OID，选中即定位；作者候选没有 OID，选中后执行搜索。 */
  oid?: string;
}

/** 候选词只来自已加载的图谱页；输入为空时不给候选。 */
export function buildSuggestions(input: string, commits: CommitSummaryDto[]): Suggestion[] {
  const needle = input.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const authors = new Map<string, number>();
  for (const commit of commits) {
    authors.set(commit.author_name, (authors.get(commit.author_name) ?? 0) + 1);
  }
  const authorHits = [...authors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .filter((name) => name.toLowerCase().includes(needle));

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (suggestion: Suggestion) => {
    const key = suggestion.text.toLowerCase();
    if (!suggestion.text || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(suggestion);
  };

  for (const name of authorHits.slice(0, 2)) {
    push({ text: name });
  }
  for (const commit of commits) {
    if (out.length >= SUGGESTION_LIMIT) {
      break;
    }
    if (commit.summary.toLowerCase().includes(needle)) {
      push({ text: commit.summary, oid: commit.oid });
    }
  }
  return out;
}
