import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "git-graph.diff-ignore-whitespace";

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let current: boolean = readStored();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

/** 当前全局偏好（非 React 上下文读取）。 */
export function getIgnoreWhitespace(): boolean {
  return current;
}

/** 写入偏好并通知所有 diff 调用方；同一取值的重复写入直接忽略。 */
export function setIgnoreWhitespace(next: boolean) {
  if (next === current) {
    return;
  }
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
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
    const next = event.newValue === "1";
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

/**
 * 全局「忽略空白差异」偏好：localStorage 持久化，所有取 diff 的视图共同跟随。
 * 取 diff 的调用方必须把它放进请求依赖，切换后重新读取。
 */
export function useIgnoreWhitespace(): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getIgnoreWhitespace, getIgnoreWhitespace);
  const set = useCallback((next: boolean) => setIgnoreWhitespace(next), []);
  return [value, set];
}
