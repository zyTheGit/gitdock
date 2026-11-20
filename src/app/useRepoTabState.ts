import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphLoader } from "../features/graph/useGraph";
import type { GraphScope, RepoId } from "../shared/types";
import type { ViewMode } from "./useGlobalEsc";

/** 单个标签的 UI 视图态（ADR-0032）：只存内存，不持久化。 */
export interface TabViewSnapshot {
  scope: GraphScope;
  selectedOid: string | null;
  mode: ViewMode;
  pathFilter: string;
  twoDot: boolean;
  scrollTop: number;
}

/** 图谱滚动恢复桥：pending 由标签切换写入，GraphList 在目标仓库首屏落地后消费。 */
export interface ScrollRestore {
  top: number | null;
  onConsumed: () => void;
  onScroll: (top: number) => void;
}

export interface RepoTabViewState {
  scope: GraphScope;
  setScope: (scope: GraphScope) => void;
  selectedOid: string | null;
  setSelectedOid: (oid: string | null) => void;
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  pathFilter: string;
  setPathFilter: (value: string) => void;
  twoDot: boolean;
  setTwoDot: (value: boolean) => void;
  /**
   * 标签切换：先快照当前标签，再恢复目标标签（fresh=true 表示新打开的仓库，丢弃旧记录）。
   * nextId 为 null 表示回到欢迎页。
   */
  switchTo: (nextId: RepoId | null, fresh: boolean) => void;
  /** 标签关闭：丢弃该仓库的视图态。 */
  forget: (id: RepoId) => void;
  /** 清空当前标签视图（打开失败、显式归零）。 */
  resetView: () => void;
  scrollRestore: ScrollRestore;
  /** 切换标签后待校验的选中提交：目标仓库首屏落地时若不存在则清除选中。 */
  pendingSelection: string | null;
  consumeSelection: () => void;
}

const DEFAULT_SNAPSHOT: TabViewSnapshot = {
  scope: { kind: "head" },
  selectedOid: null,
  mode: "graph",
  pathFilter: "",
  twoDot: false,
  scrollTop: 0,
};

/**
 * 每标签 UI 视图态（ADR-0032）：scope、选中提交、主区模式、路径过滤、双点对比与
 * 图谱滚动位置按仓库 id 存在内存 Map 中。对比槽位由 useCompareSlots 按同一 tabKey 保存，
 * 因此这里不再重复持有。
 */
export function useRepoTabState(): RepoTabViewState {
  const [scope, setScope] = useState<GraphScope>(DEFAULT_SNAPSHOT.scope);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(DEFAULT_SNAPSHOT.mode);
  const [pathFilter, setPathFilter] = useState("");
  const [twoDot, setTwoDot] = useState(false);
  const [pendingScroll, setPendingScroll] = useState<number | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);

  const activeRef = useRef<RepoId | null>(null);
  const scrollRef = useRef(0);
  const savedRef = useRef(new Map<RepoId, TabViewSnapshot>());
  const latestRef = useRef({ scope, selectedOid, mode, pathFilter, twoDot });
  latestRef.current = { scope, selectedOid, mode, pathFilter, twoDot };

  const apply = useCallback((next: TabViewSnapshot) => {
    setScope(next.scope);
    setSelectedOid(next.selectedOid);
    setMode(next.mode);
    setPathFilter(next.pathFilter);
    setTwoDot(next.twoDot);
    setPendingSelection(next.selectedOid);
    scrollRef.current = next.scrollTop;
    setPendingScroll(next.scrollTop > 0 ? next.scrollTop : null);
  }, []);

  const switchTo = useCallback(
    (nextId: RepoId | null, fresh: boolean) => {
      const current = activeRef.current;
      // 同一标签重复打开/重述：视图态保持不变，不必先归零再恢复。
      if (current === nextId) {
        return;
      }
      if (current !== null) {
        savedRef.current.set(current, { ...latestRef.current, scrollTop: scrollRef.current });
      }
      if (nextId !== null && fresh) {
        savedRef.current.delete(nextId);
      }
      const restored = nextId !== null && !fresh ? savedRef.current.get(nextId) : undefined;
      activeRef.current = nextId;
      apply(restored ?? DEFAULT_SNAPSHOT);
    },
    [apply],
  );

  const forget = useCallback((id: RepoId) => {
    savedRef.current.delete(id);
    if (activeRef.current === id) {
      activeRef.current = null;
    }
  }, []);

  const resetView = useCallback(() => {
    scrollRef.current = 0;
    setPendingScroll(null);
    setPendingSelection(null);
    apply(DEFAULT_SNAPSHOT);
  }, [apply]);

  const scrollRestore = useMemo<ScrollRestore>(
    () => ({
      top: pendingScroll,
      onConsumed: () => setPendingScroll(null),
      onScroll: (top: number) => {
        scrollRef.current = top;
      },
    }),
    [pendingScroll],
  );

  const consumeSelection = useCallback(() => setPendingSelection(null), []);

  return {
    scope,
    setScope,
    selectedOid,
    setSelectedOid,
    mode,
    setMode,
    pathFilter,
    setPathFilter,
    twoDot,
    setTwoDot,
    switchTo,
    forget,
    resetView,
    scrollRestore,
    pendingSelection,
    consumeSelection,
  };
}

/**
 * 选中提交恢复校验（ADR-0032）：标签切换后不等旧页数据下结论，
 * 只在新仓库首屏落地后检查该 OID 是否仍在本页；不存在则清除选中。
 */
export function useTabSelectionGuard(
  graph: GraphLoader,
  repoPath: string | null,
  pending: string | null,
  onMissing: () => void,
  onChecked: () => void,
) {
  useEffect(() => {
    if (!repoPath || !pending || graph.loading || graph.loadedRepo !== repoPath) {
      return;
    }
    const rows = graph.view.rows;
    if (rows.length === 0) {
      return;
    }
    if (!rows.some((row) => (row.commit?.oid ?? row.layout.oid) === pending)) {
      onMissing();
    }
    onChecked();
  }, [repoPath, pending, graph.loading, graph.loadedRepo, graph.view.rows, onMissing, onChecked]);
}
