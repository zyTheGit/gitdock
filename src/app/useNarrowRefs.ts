import { useCallback, useEffect, useRef, useState } from "react";

export const REFS_POPOVER_ID = "gitdock-refs-popover";
const NARROW_VIEWPORT = "(max-width: 640px)";

/** 窄窗口引用入口：媒体查询与 AppShell 侧栏可见性共用同一个开合状态来源。 */
export function useNarrowRefs() {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia(NARROW_VIEWPORT).matches);
  const [isOpen, setIsOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia(NARROW_VIEWPORT);
    const onChange = () => {
      setIsNarrow(media.matches);
      // 跨越边界立即卸载浮层，不保留遮罩或旧焦点状态。
      if (!media.matches) {
        setIsOpen(false);
        setSidebarVisible(true);
      }
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggleRefs = useCallback(() => {
    if (isNarrow) {
      setIsOpen((open) => !open);
    } else {
      setSidebarVisible((visible) => !visible);
    }
  }, [isNarrow]);
  const closeRefs = useCallback(() => setIsOpen(false), []);

  return { isNarrow, isOpen, sidebarVisible, triggerRef, toggleRefs, closeRefs };
}
