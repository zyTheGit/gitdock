import { useCallback, useEffect, useRef, useState } from "react";

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

  // 宽度落盘走“拖动中只进内存，抬手/卸载统一冲刷”：
  // 拖动中仅 setState 保证实时视觉反馈，localStorage 只在 pointerup 等低频时机写一次。
  const sidebarRef = useRef(sidebarWidth);
  const detailRef = useRef(preferredDetailWidth);
  const dirtyRef = useRef({ sidebar: false, detail: false });
  const pointerDownRef = useRef(false);

  const flush = useCallback(() => {
    if (dirtyRef.current.sidebar) {
      dirtyRef.current.sidebar = false;
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarRef.current));
    }
    if (dirtyRef.current.detail) {
      dirtyRef.current.detail = false;
      localStorage.setItem(DETAIL_WIDTH_KEY, String(detailRef.current));
    }
  }, []);

  const commitSidebar = useCallback(
    (next: number) => {
      sidebarRef.current = next;
      dirtyRef.current.sidebar = true;
      setSidebarWidth(next);
      // 键盘微调、双击复位等非拖拽来源没有后续 pointerup，直接落盘保持原有语义。
      if (!pointerDownRef.current) {
        flush();
      }
    },
    [flush],
  );

  const commitDetail = useCallback(
    (next: number) => {
      detailRef.current = next;
      dirtyRef.current.detail = true;
      setPreferredDetailWidth(next);
      if (!pointerDownRef.current) {
        flush();
      }
    },
    [flush],
  );

  // 指针按下期间视为潜在拖拽：期间宽度变化只进内存，抬手或取消时一次性落盘。
  useEffect(() => {
    const onPointerDown = () => {
      pointerDownRef.current = true;
    };
    const onPointerEnd = () => {
      pointerDownRef.current = false;
      flush();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      // 卸载兜底：拖拽中途切视图也保住未落盘的最新宽度。
      flush();
    };
  }, [flush]);

  // resize 用 rAF 合帧：回调里读最新视口宽度，连续 resize 只触发一次重渲染。
  useEffect(() => {
    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        setViewportWidth(window.innerWidth);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  const detailMax = Math.max(
    DETAIL_WIDTH.min,
    Math.min(DETAIL_WIDTH.max, viewportWidth - sidebarWidth - GRAPH_MIN_WIDTH),
  );
  const detailWidth = Math.min(preferredDetailWidth, detailMax);

  return {
    sidebarWidth,
    setSidebarWidth: commitSidebar,
    detailWidth,
    setDetailWidth: commitDetail,
    detailMax,
  };
}
