import { useEffect, useState } from "react";

export const SIDEBAR_WIDTH = { min: 200, max: 520, reset: 280 } as const;
export const DETAIL_WIDTH = { min: 340, max: 960, reset: 620 } as const;

const SIDEBAR_WIDTH_KEY = "git-graph.sidebar-width";
const DETAIL_WIDTH_KEY = "git-graph.detail-width";

function storedPaneWidth(key: string, min: number, max: number, fallback: number): number {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? Math.min(max, Math.max(min, stored)) : fallback;
}

/** 侧栏与详情面板宽度：本地持久化，并随窗口收紧详情上限，避免挤占图谱。 */
export function usePaneWidths() {
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedPaneWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max, SIDEBAR_WIDTH.reset),
  );
  const [detailWidth, setDetailWidth] = useState(() =>
    storedPaneWidth(DETAIL_WIDTH_KEY, DETAIL_WIDTH.min, DETAIL_WIDTH.max, DETAIL_WIDTH.reset),
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const detailMax = Math.max(
    DETAIL_WIDTH.min,
    Math.min(DETAIL_WIDTH.max, viewportWidth - sidebarWidth - 400),
  );
  useEffect(() => {
    setDetailWidth((current) => Math.min(current, detailMax));
  }, [detailMax]);

  return { sidebarWidth, setSidebarWidth, detailWidth, setDetailWidth, detailMax };
}
