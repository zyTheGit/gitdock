import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import type { CommitSummaryDto } from "../../shared/types";
import { CommitHoverCard } from "./CommitHoverCard";
import { GraphRow } from "./GraphRow";
import type { GraphView } from "./model";
import { useCommitHover } from "./useCommitHover";

const ROW_HEIGHT = 34;
const LOAD_MORE_THRESHOLD = 12;

/** 标签切换后的图谱滚动恢复请求；新仓库首屏落地（loadedPath 对齐）后才消费。 */
export interface GraphScrollRestore {
  top: number | null;
  ownerPath: string | null;
  loadedPath: string | null;
  onConsumed: () => void;
}

interface GraphListProps {
  view: GraphView;
  loading: boolean;
  loadingMore: boolean;
  selectedOid: string | null;
  /** 批量选择集合；顺序即执行顺序。 */
  selectedOids: string[];
  focusedOid?: string | null;
  /** 定位请求序号：每次定位递增，用于只滚动一次。 */
  focusSeq?: number | null;
  /** 标签切换时恢复滚动位置（ADR-0032）。 */
  scrollRestore?: GraphScrollRestore | null;
  /** 用户滚动时上报偏移，供标签快照保存。 */
  onScrollTop?: (top: number) => void;
  onSelect: (oid: string) => void;
  onRangeSelect?: (oid: string) => void;
  onToggleSelect?: (oid: string) => void;
  onCtrlSelect?: (commit: CommitSummaryDto) => void;
  onContextMenu?: (
    event: MouseEvent,
    commit: CommitSummaryDto,
    selectedCommits: CommitSummaryDto[],
  ) => void;
  selectionIndexOf: (oid: string) => number;
  onLoadMore: () => void;
}

export function GraphList({
  view,
  loading,
  loadingMore,
  selectedOid,
  selectedOids,
  focusedOid,
  focusSeq,
  scrollRestore,
  onScrollTop,
  onSelect,
  onRangeSelect,
  onToggleSelect,
  onCtrlSelect,
  onContextMenu,
  selectionIndexOf,
  onLoadMore,
}: GraphListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { hover, queueHover, cancelHover } = useCommitHover(view.viewKey);

  const laneCount = useMemo(() => {
    let max = 1;
    for (const row of view.rows) {
      max = Math.max(max, row.layout.lane_count);
    }
    return max;
  }, [view.rows]);

  const virtualizer = useVirtualizer({
    count: view.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
    getItemKey: (index) => view.rows[index]?.layout.oid ?? index,
  });

  // 重置 view 时回到顶部；追加页面时保持滚动位置。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [view.viewKey]);

  // 标签切换的滚动恢复：必须等目标仓库的首屏落地（loadedPath 对齐）再滚，
  // 否则会滚到上一个标签残留的行上并被旧内容吞掉。
  const restoreTop = scrollRestore?.top ?? null;
  const restoreLoadedPath = scrollRestore?.loadedPath ?? null;
  const restoreOwnerPath = scrollRestore?.ownerPath ?? null;
  const consumeRestore = scrollRestore?.onConsumed;
  useEffect(() => {
    if (restoreTop === null || view.rows.length === 0) {
      return;
    }
    if (!restoreOwnerPath || restoreLoadedPath !== restoreOwnerPath) {
      return;
    }
    scrollRef.current?.scrollTo({ top: restoreTop });
    consumeRestore?.();
  }, [restoreTop, restoreOwnerPath, restoreLoadedPath, view.rows.length, consumeRestore]);

  // 搜索结果定位：每个请求只滚动一次，避免后续追加页面时把用户拽回定位行。
  const scrolledFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!focusedOid || focusSeq === null || focusSeq === undefined) {
      return;
    }
    if (scrolledFocus.current === focusSeq) {
      return;
    }
    const index = view.rows.findIndex((row) => row.layout.oid === focusedOid);
    if (index < 0) {
      return;
    }
    scrolledFocus.current = focusSeq;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [focusedOid, focusSeq, view.rows, virtualizer]);

  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (!last) {
      return;
    }
    if (view.hasMore && !loadingMore && last.index >= view.rows.length - LOAD_MORE_THRESHOLD) {
      onLoadMore();
    }
  }, [items, view.hasMore, view.rows.length, loadingMore, onLoadMore]);

  // oid → 提交对象：事件委托时按行上的 data-oid 反查行数据。
  const commitsByOid = useMemo(() => {
    const map = new Map<string, CommitSummaryDto | undefined>();
    for (const row of view.rows) {
      const oid = row.commit?.oid ?? row.layout.oid;
      if (!map.has(oid)) {
        map.set(oid, row.commit);
      }
    }
    return map;
  }, [view.rows]);

  // 行交互全部委托到列表容器一次挂接，行组件不再携带回调 props，
  // GraphRow 靠 memo 浅比较即可阻断无关状态（toast、悬浮卡等）引发的全行重渲染。
  const hoveredOidRef = useRef<string | null>(null);

  const handleListClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const oid = (event.target as Element).closest("[data-oid]")?.getAttribute("data-oid");
      if (!oid) {
        return;
      }

      const commit = commitsByOid.get(oid);
      cancelHover();
      // Alt/Option+点击切换单个提交；Shift+点击做区间选择；Ctrl/Cmd+点击填对比槽；普通点击打开详情。
      if (event.altKey && onToggleSelect) {
        event.preventDefault();
        onToggleSelect(oid);
        return;
      }
      if (event.shiftKey && onRangeSelect) {
        event.preventDefault();
        onRangeSelect(oid);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && commit && onCtrlSelect) {
        event.preventDefault();
        onCtrlSelect(commit);
        return;
      }
      onSelect(oid);
    },
    [commitsByOid, cancelHover, onCtrlSelect, onRangeSelect, onSelect, onToggleSelect],
  );

  const handleListContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const oid = (event.target as Element).closest("[data-oid]")?.getAttribute("data-oid");
      if (!oid) {
        return;
      }
      const commit = commitsByOid.get(oid);
      cancelHover();
      if (commit && onContextMenu) {
        event.preventDefault();
        const selectedCommits = selectedOids
          .map((selectedOid) => commitsByOid.get(selectedOid))
          .filter((item): item is CommitSummaryDto => Boolean(item));
        onContextMenu(event, commit, selectedCommits);
      }
    },
    [commitsByOid, cancelHover, onContextMenu, selectedOids],
  );

  // 仅当鼠标移入 Graph 列的提交圆点热区（[data-graph-node]）时才触发悬浮卡；
  // 移出圆点或划过文字行时立即取消，避免遮挡阅读。
  const handleListMouseOver = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const node = (event.target as Element).closest("[data-graph-node]");
      if (!node) {
        if (hoveredOidRef.current !== null) {
          hoveredOidRef.current = null;
          cancelHover();
        }
        return;
      }
      const oid = node.closest("[data-oid]")?.getAttribute("data-oid") ?? null;
      if (oid === hoveredOidRef.current) {
        return;
      }
      hoveredOidRef.current = oid;
      cancelHover();
      const commit = oid ? commitsByOid.get(oid) : undefined;
      const lane = Number(node.getAttribute("data-lane") ?? 0);
      if (commit) {
        queueHover(event, commit, Number.isFinite(lane) ? lane : 0);
      }
    },
    [commitsByOid, cancelHover, queueHover],
  );

  const handleListMouseLeave = useCallback(() => {
    hoveredOidRef.current = null;
    cancelHover();
  }, [cancelHover]);

  // 滚动会销毁并重建行 DOM，顺带清掉悬浮行追踪，让鼠标再次移动时能重新触发。
  const handleListScroll = useCallback(() => {
    hoveredOidRef.current = null;
    cancelHover();
    onScrollTop?.(scrollRef.current?.scrollTop ?? 0);
  }, [cancelHover, onScrollTop]);

  // 键盘上下键：只在列表自身拥有焦点时移动选中行并滚动到可视区；
  // 弹窗打开或有修饰键（终端/系统组合）时不拦截。焦点在底部面板内时事件
  // 根本不会落到本容器，方向键自然归终端程序所有。
  const handleListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (document.querySelector(".modal-backdrop")) {
        return;
      }
      const rows = view.rows;
      if (rows.length === 0) {
        return;
      }
      const currentIndex = rows.findIndex(
        (row) => (row.commit?.oid ?? row.layout.oid) === selectedOid,
      );
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
      event.preventDefault();
      if (nextIndex === currentIndex) {
        return;
      }
      virtualizer.scrollToIndex(nextIndex, { align: "auto" });
      const row = rows[nextIndex];
      onSelect(row.commit?.oid ?? row.layout.oid);
    },
    [onSelect, selectedOid, view.rows, virtualizer],
  );

  if (loading && view.rows.length === 0) {
    return <div className="graph-empty muted">{t("graph.loadingCommits")}</div>;
  }
  if (!loading && view.rows.length === 0) {
    return <div className="graph-empty muted">{t("graph.noCommits")}</div>;
  }

  return (
    <div
      className="graph-list"
      ref={scrollRef}
      tabIndex={0}
      role="listbox"
      aria-label={t("graph.listAria")}
      aria-activedescendant={selectedOid ? `graph-row-${selectedOid}` : undefined}
      onKeyDown={handleListKeyDown}

      onClick={handleListClick}
      onContextMenu={handleListContextMenu}
      onMouseOver={handleListMouseOver}
      onMouseLeave={handleListMouseLeave}
      onScroll={handleListScroll}
    >
      <div className="graph-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const row = view.rows[item.index];
          if (!row) {
            return null;
          }
          const commit = row.commit;
          const oid = commit?.oid ?? row.layout.oid;
          return (
            <GraphRow
              key={item.key}
              oid={oid}
              commit={commit}
              layout={row.layout}
              laneCount={laneCount}
              start={item.start}
              height={ROW_HEIGHT}
              selected={selectedOid === oid}
              selectionIndex={selectionIndexOf(oid)}
              batchActive={selectedOids.length > 0}
              located={focusedOid === oid}
            />
          );
        })}
      </div>
      {loadingMore && <div className="graph-loading muted">{t("graph.loadingMore")}</div>}
      {hover && (
        <CommitHoverCard
          commit={hover.commit}
          lane={hover.lane}
          x={hover.x}
          y={hover.y}
          context={hover.context}
          contextLoading={hover.contextLoading}
        />
      )}
    </div>
  );
}
