import { useSyncExternalStore } from "react";

/** 入口来源：只影响对话框里的补充说明（暂存区入口看到的是 HEAD 内容）。 */
export type FileHistoryOrigin = "commit" | "compare" | "staging";

/** 对话框初始页签。 */
export type FileHistoryTab = "history" | "blame";

/** 一次「查看文件历史 / Blame」请求的目标。 */
export interface FileHistoryTarget {
  /** 仓库内相对路径。 */
  path: string;
  /** 起点提交：Blame 读取该提交中的文件，文件历史从该提交（含）向前追溯。 */
  oid: string;
  origin: FileHistoryOrigin;
  /** 从哪个页签打开：右键「查看 Blame」直接落在 Blame。 */
  tab: FileHistoryTab;
}

let current: FileHistoryTarget | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): FileHistoryTarget | null {
  return current;
}

/** 打开对话框；任何视图都可直接调用，无需层层透传回调。 */
export function openFileHistory(target: FileHistoryTarget) {
  current = target;
  emit();
}

export function closeFileHistory() {
  if (current === null) {
    return;
  }
  current = null;
  emit();
}

/** 当前目标（null 表示对话框关闭）。 */
export function useFileHistoryTarget(): FileHistoryTarget | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
