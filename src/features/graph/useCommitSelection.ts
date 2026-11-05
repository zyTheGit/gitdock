import { useCallback, useRef, useState } from "react";

export interface CommitSelection {
  /** 当前选中的 OID，顺序即用户选择顺序。 */
  oids: string[];
  isSelected: (oid: string) => boolean;
  /** 选中序号（0 起始）；未选中返回 -1。 */
  indexOf: (oid: string) => number;
  selectRange: (oid: string) => void;
  /** 单个提交加入/移出选择（Alt/Option+点击）。 */
  toggle: (oid: string) => void;
  /** 普通点击只记录锚点，不加入批量选择；供「点击 A → Shift 点击 B」的区间语义使用。 */
  setAnchor: (oid: string) => void;
  clear: () => void;
}

/**
 * 图谱批量选择：
 * - 普通点击 A：打开详情并记录锚点（不进入批量选择）。
 * - Shift 点击 B：以锚点为起点，按当前视图顺序选择 A..B 区间。
 * - Shift 点击 A 再 Shift 点击 B：第一次 Shift 点击同样会设锚点。
 *
 * 锚点与选择集合保存在 ref 中，避免连续点击时读取过期的 React 闭包状态。
 */
export function useCommitSelection(orderedOids: string[]): CommitSelection {
  const [oids, setOids] = useState<string[]>([]);
  const oidsRef = useRef<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const orderedRef = useRef(orderedOids);
  orderedRef.current = orderedOids;

  const apply = useCallback((nextOids: string[], nextAnchor: string | null) => {
    oidsRef.current = nextOids;
    anchorRef.current = nextAnchor;
    setOids(nextOids);
  }, []);

  const clear = useCallback(() => apply([], null), [apply]);

  const setAnchor = useCallback((oid: string) => {
    anchorRef.current = oid;
  }, []);

  const selectRange = useCallback(
    (oid: string) => {
      const ordered = orderedRef.current;
      const target = ordered.indexOf(oid);
      if (target < 0) {
        return;
      }
      const anchor = anchorRef.current;
      const start = anchor ? ordered.indexOf(anchor) : -1;
      if (start < 0) {
        const current = oidsRef.current;
        // 没有可用锚点（如首次 Shift 点击）：从当前项开始。
        apply(current.includes(oid) ? current : [...current, oid], oid);
        return;
      }
      const from = Math.min(start, target);
      const to = Math.max(start, target);
      const range = ordered.slice(from, to + 1);
      const orderedRange = start <= target ? range : [...range].reverse();
      // 合并而不是替换：即使锚点已过期，也不让 Shift 扩展把已选提交挤掉。
      const merged = [...oidsRef.current];
      for (const item of orderedRange) {
        if (!merged.includes(item)) {
          merged.push(item);
        }
      }
      apply(merged, anchor);
    },
    [apply],
  );

  const indexOf = useCallback((oid: string) => oids.indexOf(oid), [oids]);
  const isSelected = useCallback((oid: string) => oids.includes(oid), [oids]);

  const toggle = useCallback(
    (oid: string) => {
      const current = oidsRef.current;
      if (current.includes(oid)) {
        apply(
          current.filter((item) => item !== oid),
          anchorRef.current === oid ? null : anchorRef.current,
        );
        return;
      }
      apply([...current, oid], anchorRef.current ?? oid);
    },
    [apply],
  );

  return { oids, isSelected, indexOf, selectRange, toggle, setAnchor, clear };
}