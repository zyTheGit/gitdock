import { useCallback, useRef, useState } from "react";
import {
  selectCommitRange,
  toggleCommitSelection,
  type ToggleCommitOptions,
} from "./commitSelection";

export interface CommitSelection {
  /** 当前选中的 OID，顺序即用户选择顺序。 */
  oids: string[];
  isSelected: (oid: string) => boolean;
  /** 选中序号（0 起始）；未选中返回 -1。 */
  indexOf: (oid: string) => number;
  selectRange: (oid: string) => void;
  /** 单个提交加入/移出选择（点选勾选框、多选模式点击或 Alt/Option+点击）。 */
  toggle: (oid: string, options?: ToggleCommitOptions) => void;
  /** 普通点击只记录锚点，不加入批量选择；供「点击 A → Shift 点击 B」的区间语义使用。 */
  setAnchor: (oid: string) => void;
  clear: () => void;
}

/**
 * 图谱与对比视图共用的提交批量选择：
 * - 普通点击 A：打开详情并记录锚点（不进入批量选择）。
 * - Shift 点击 B：以锚点为起点，按当前视图顺序选择 A..B 区间。
 * - 点选勾选框 / 多选模式点击 / Alt+点击：将单个提交加入或移出选择并更新锚点。
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
      const next = selectCommitRange(
        { oids: oidsRef.current, anchor: anchorRef.current },
        oid,
        orderedRef.current,
      );
      apply(next.oids, next.anchor);
    },
    [apply],
  );

  const indexOf = useCallback((oid: string) => oids.indexOf(oid), [oids]);
  const isSelected = useCallback((oid: string) => oids.includes(oid), [oids]);

  const toggle = useCallback(
    (oid: string, options?: ToggleCommitOptions) => {
      const next = toggleCommitSelection(
        { oids: oidsRef.current, anchor: anchorRef.current },
        oid,
        orderedRef.current,
        options,
      );
      apply(next.oids, next.anchor);
    },
    [apply],
  );

  return { oids, isSelected, indexOf, selectRange, toggle, setAnchor, clear };
}
