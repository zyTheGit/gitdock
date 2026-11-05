import { useEffect, useRef } from "react";
import { useCompareSlots } from "../features/compare/useCompare";
import { isEscConsumed, isEventInBottomPanel } from "../shared/esc";

/** 主区视图模式：图谱 / 对比 / 搜索 / 暂存区。 */
export type ViewMode = "graph" | "compare" | "search" | "staging";

/** 双槽状态（Base / Compare 选择）由 useCompareSlots 提供，这里只消费其 Esc 相关成员。 */
type CompareSlots = ReturnType<typeof useCompareSlots>;

interface UseGlobalEscParams {
  closeSearch: () => void;
  mode: ViewMode;
  slots: CompareSlots;
  setMode: (mode: ViewMode) => void;
}

/**
 * 全局 Esc：优先取消待替换选择，其次退出搜索/对比，最后清空双槽。
 * 放大 diff 在捕获阶段已消费的 Esc（isEscConsumed）不再触发界面退出，
 * 保证一次按键只退出一层。依赖通过 ref 现读（参照 useKeybindings 的
 * handlersRef 模式），避免 slots 每次渲染返回新对象导致监听器反复重装。
 */
export function useGlobalEsc({ closeSearch, mode, slots, setMode }: UseGlobalEscParams) {
  const escStateRef = useRef({ closeSearch, mode, slots });
  escStateRef.current = { closeSearch, mode, slots };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (isEscConsumed(event)) {
        return;
      }
      // 底部面板内的 Esc 归面板内容（终端程序或日志视图），不触发界面退出逻辑。
      if (isEventInBottomPanel(event)) {
        return;
      }
      const { closeSearch, mode, slots } = escStateRef.current;
      // 暂存区自行处理 Esc（先收起放大 diff，再退出视图）。
      if (mode === "staging") {
        return;
      }
      if (slots.pending) {
        slots.resolvePending(null);
        return;
      }
      if (mode === "search") {
        closeSearch();
        return;
      }
      if (mode === "compare") {
        setMode("graph");
        return;
      }
      if (slots.base || slots.compare) {
        slots.clearAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // setMode 为 React state setter，引用稳定。
  }, [setMode]);
}