import { useCallback, useSyncExternalStore } from "react";

/** diff 展示形态：并排（split）或统一（unified）。 */
export type DiffViewType = "split" | "unified";

const STORAGE_KEY = "git-graph.diff-view-type";

function readStoredType(): DiffViewType {
  try {
    return localStorage.getItem(STORAGE_KEY) === "unified" ? "unified" : "split";
  } catch {
    return "split";
  }
}

let current: DiffViewType = readStoredType();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

/** 当前全局偏好（非 React 上下文读取）。 */
export function getDiffViewType(): DiffViewType {
  return current;
}

/** 写入偏好并通知所有 diff 视图；同一取值的重复写入直接忽略。 */
export function setDiffViewType(next: DiffViewType) {
  if (next === current) {
    return;
  }
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 持久化失败（隐私模式等）不影响本次会话内的切换。
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 其他窗口修改同一偏好时同步（localStorage 写入不会在本窗口触发 storage 事件）。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    const next: DiffViewType = event.newValue === "unified" ? "unified" : "split";
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

/**
 * 全局「并排 / 统一」偏好：localStorage 持久化，提交详情、对比与暂存区的 diff
 * 共用同一份状态，任一视图切换后其余视图立即跟随，重启后保持。
 */
export function useDiffViewType(): [DiffViewType, (type: DiffViewType) => void] {
  const type = useSyncExternalStore(subscribe, getDiffViewType, getDiffViewType);
  const set = useCallback((next: DiffViewType) => setDiffViewType(next), []);
  return [type, set];
}
