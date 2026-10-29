import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummaryDto } from "../../shared/types";
import { CommitHoverCard } from "./CommitHoverCard";
import { GraphRow } from "./GraphRow";
import type { GraphView } from "./model";
import { useCommitHover } from "./useCommitHover";

const ROW_HEIGHT = 34;
const LOAD_MORE_THRESHOLD = 12;

interface GraphListProps {
  view: GraphView;
  loading: boolean;
  loadingMore: boolean;
  selectedOid: string | null;
  focusedOid?: string | null;
  /** 定位请求序号：每次定位递增，用于只滚动一次。 */
  focusSeq?: number | null;
  onSelect: (oid: string) => void;
  onCtrlSelect?: (commit: CommitSummaryDto) => void;
  onContextMenu?: (event: MouseEvent, commit: CommitSummaryDto) => void;
  onLoadMore: () => void;
}

export function GraphList({
  view,
  loading,
  loadingMore,
  selectedOid,
  focusedOid,
  focusSeq,
  onSelect,
  onCtrlSelect,
  onContextMenu,
  onLoadMore,
}: GraphListProps) {
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

  if (loading && view.rows.length === 0) {
    return <div className="graph-empty muted">正在读取提交…</div>;
  }
  if (!loading && view.rows.length === 0) {
    return <div className="graph-empty muted">当前视图没有可显示的提交。</div>;
  }

  return (
    <div className="graph-list" ref={scrollRef} onScroll={cancelHover}>
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
              located={focusedOid === oid}
              onRowClick={(event) => {
                cancelHover();
                // Ctrl / Cmd + 点击填对比槽；普通点击打开详情。
                if ((event.ctrlKey || event.metaKey) && commit && onCtrlSelect) {
                  event.preventDefault();
                  onCtrlSelect(commit);
                  return;
                }
                onSelect(oid);
              }}
              onRowContextMenu={(event) => {
                cancelHover();
                if (commit && onContextMenu) {
                  event.preventDefault();
                  onContextMenu(event, commit);
                }
              }}
              onRowMouseEnter={(event) => {
                if (commit) {
                  queueHover(event, commit);
                }
              }}
              onRowMouseLeave={cancelHover}
            />
          );
        })}
      </div>
      {loadingMore && <div className="graph-loading muted">加载更多…</div>}
      {hover && (
        <CommitHoverCard
          commit={hover.commit}
          x={hover.x}
          y={hover.y}
          context={hover.context}
          contextLoading={hover.contextLoading}
        />
      )}
    </div>
  );
}
