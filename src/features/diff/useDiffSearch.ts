import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const HIT_CLASS = "diff-search-hit";
const ACTIVE_CLASS = "diff-search-hit-active";
// 统一视图的行内容格是 .diff-code，自绘并排视图是 .split-code；两种都要命中。
const CELL_SELECTOR = ".diff-code, .split-code";

export interface DiffSearchState {
  count: number;
  activeIndex: number;
  next: () => void;
  prev: () => void;
}

/**
 * 在已渲染的 diff DOM 内做纯前端搜索（ADR-0030 §2.7）：按行内容格匹配，
 * 给命中行加高亮类并把当前命中滚到视野中央。
 *
 * `scanKey` 用于在视图形态 / patch / 高亮 token 变化后重新扫描——
 * React 重渲染会重建行节点，之前加的类名随之丢失。
 */
export function useDiffSearch(
  containerRef: RefObject<HTMLElement | null>,
  query: string,
  open: boolean,
  scanKey: string,
): DiffSearchState {
  const [hits, setHits] = useState<HTMLElement[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const hitsRef = useRef<HTMLElement[]>([]);

  const clearMarks = useCallback(() => {
    for (const element of hitsRef.current) {
      element.classList.remove(HIT_CLASS, ACTIVE_CLASS);
    }
    hitsRef.current = [];
  }, []);

  useEffect(() => {
    clearMarks();
    const needle = query.trim().toLocaleLowerCase();
    const container = containerRef.current;
    if (!open || !needle || !container) {
      setHits([]);
      setActiveIndex(0);
      return;
    }
    const found = Array.from(container.querySelectorAll<HTMLElement>(CELL_SELECTOR)).filter(
      (cell) => (cell.textContent ?? "").toLocaleLowerCase().includes(needle),
    );
    for (const element of found) {
      element.classList.add(HIT_CLASS);
    }
    hitsRef.current = found;
    setHits(found);
    setActiveIndex(0);
    return clearMarks;
  }, [open, query, scanKey, containerRef, clearMarks]);

  useEffect(() => {
    hits.forEach((element, index) => {
      element.classList.toggle(ACTIVE_CLASS, index === activeIndex);
    });
    hits[activeIndex]?.scrollIntoView({ block: "center" });
  }, [hits, activeIndex]);

  const next = useCallback(() => {
    setActiveIndex((index) => (hits.length === 0 ? 0 : (index + 1) % hits.length));
  }, [hits.length]);

  const prev = useCallback(() => {
    setActiveIndex((index) => (hits.length === 0 ? 0 : (index - 1 + hits.length) % hits.length));
  }, [hits.length]);

  return { count: hits.length, activeIndex, next, prev };
}
