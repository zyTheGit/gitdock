import { useEffect, useState } from "react";

export const SIDEBAR_WIDTH = { min: 200, max: 520, reset: 280 } as const;
// 默认宽度以“图谱不出现横向滚动条”为准，再宽会挤压中间提交列表。
export const DETAIL_WIDTH = { min: 340, max: 960, reset: 620 } as const;

const SIDEBAR_WIDTH_KEY = "git-graph.sidebar-width";
// v3 与旧键分开：旧版本会把缩放时的临时夹取当作用户宽度写回。
const DETAIL_WIDTH_KEY = "git-graph.detail-width-v3";
const LEGACY_DETAIL_WIDTH_KEY = "git-graph.detail-width";
const LEGACY_DETAIL_RESET = 620;
// 图谱至少保留的宽度，详情面板再宽也不能把图谱挤没。
const GRAPH_MIN_WIDTH = 320;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readWidth(key: string, min: number, max: number): number | null {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clampWidth(stored, min, max) : null;
}

/** 旧键里的 620 是上一版默认值，低于它的值多半是缩放夹取写回的，统一换到新默认。 */
function storedDetailWidth(): number {
  const current = readWidth(DETAIL_WIDTH_KEY, DETAIL_WIDTH.min, DETAIL_WIDTH.max);
  if (current !== null) {
    return current;
  }
  const legacy = readWidth(
    LEGACY_DETAIL_WIDTH_KEY,
    DETAIL_WIDTH.min,
    DETAIL_WIDTH.max,
  );
  return legacy !== null && legacy > LEGACY_DETAIL_RESET ? legacy : DETAIL_WIDTH.reset;
}

/** 侧栏与详情面板宽度：本地持久化用户偏好，实际宽度按当前视口夹取，不把夹取结果写回。 */
export function usePaneWidths() {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) ?? SIDEBAR_WIDTH.reset,
  );
  const [preferredDetailWidth, setPreferredDetailWidth] = useState(storedDetailWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(preferredDetailWidth));
  }, [preferredDetailWidth]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const detailMax = Math.max(
    DETAIL_WIDTH.min,
    Math.min(DETAIL_WIDTH.max, viewportWidth - sidebarWidth - GRAPH_MIN_WIDTH),
  );
  const detailWidth = Math.min(preferredDetailWidth, detailMax);

  return {
    sidebarWidth,
    setSidebarWidth,
    detailWidth,
    setDetailWidth: setPreferredDetailWidth,
    detailMax,
  };
}
