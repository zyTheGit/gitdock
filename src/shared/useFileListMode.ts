import { useCallback, useSyncExternalStore } from "react";

/** 文件列表展示形态：扁平路径列表或目录树。 */
export type FileListMode = "flat" | "tree";

const STORAGE_KEY = "gitdock.file-list-mode";

function readStoredMode(): FileListMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "tree" ? "tree" : "flat";
  } catch {
    return "flat";
  }
}

let current: FileListMode = readStoredMode();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

/** 当前全局偏好（非 React 上下文读取）。 */
export function getFileListMode(): FileListMode {
  return current;
}

/** 写入偏好并通知所有视图；同一取值的重复写入直接忽略。 */
export function setFileListMode(next: FileListMode) {
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
    const next: FileListMode = event.newValue === "tree" ? "tree" : "flat";
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

/**
 * 全局「扁平 / 目录树」偏好：localStorage 持久化，所有视图共享同一份状态，
 * 任一视图切换后其余文件列表立即跟随，重启后保持。
 */
export function useFileListMode(): [FileListMode, (mode: FileListMode) => void] {
  const mode = useSyncExternalStore(subscribe, getFileListMode, getFileListMode);
  const setMode = useCallback((next: FileListMode) => setFileListMode(next), []);
  return [mode, setMode];
}
