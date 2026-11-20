import { useCallback, useState } from "react";

/** 侧栏折叠状态：一个数组存全部已收起节点 id（分组与目录共用）。 */
const STORAGE_KEY = "gitdock.sidebar.collapsedRefs";

function readCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    // 存储损坏或不可用时按全部展开处理，不阻塞侧栏渲染。
    return [];
  }
}

export interface RefTreeCollapse {
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
}

/** 折叠状态跨重启保留；写失败只影响记忆，不影响当前交互。 */
export function useRefTreeCollapse(): RefTreeCollapse {
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  const isCollapsed = useCallback((id: string) => collapsed.includes(id), [collapsed]);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 仅失去记忆能力，当前会话仍生效。
      }
      return next;
    });
  }, []);

  return { isCollapsed, toggle };
}
