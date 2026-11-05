import { useCallback, useState } from "react";

export interface CommitSelection {
  /** 当前选中的 OID，顺序即用户选择顺序。 */
  oids: string[];
  isSelected: (oid: string) => boolean;
  /** 选中序号（0 起始）；未选中返回 -1。 */
  indexOf: (oid: string) => number;
  selectRange: (oid: string) => void;
  clear: () => void;
}

/**
 * 图谱批量选择：首次 Shift+点击设为锚点，后续 Shift+点击按当前视图顺序取区间。
 * 顺序按用户选择方向（锚点在前、目标行在后），保证 cherry-pick/revert 的执行顺序可见。
 */
export function useCommitSelection(orderedOids: string[]): CommitSelection {
  const [oids, setOids] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);

  const clear = useCallback(() => {
    setOids([]);
    setAnchor(null);
  }, []);

  const selectRange = useCallback(
    (oid: string) => {
      const target = orderedOids.indexOf(oid);
      if (target < 0) {
        return;
      }
      const start = anchor ? orderedOids.indexOf(anchor) : -1;
      if (start < 0) {
        setAnchor(oid);
        setOids([oid]);
        return;
      }
      const from = Math.min(start, target);
      const to = Math.max(start, target);
      const range = orderedOids.slice(from, to + 1);
      setOids(start <= target ? range : [...range].reverse());
    },
    [anchor, orderedOids],
  );

  const indexOf = useCallback((oid: string) => oids.indexOf(oid), [oids]);
  const isSelected = useCallback((oid: string) => oids.includes(oid), [oids]);

  return { oids, isSelected, indexOf, selectRange, clear };
}