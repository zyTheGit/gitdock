import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
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
  /** 批量选择集合；顺序即执行顺序。 */
  selectedOids: string[];
  focusedOid?: string | null;
  /** 定位请求序号：每次定位递增，用于只滚动一次。 */
  focusSeq?: number | null;
  onSelect: (oid: string) => void;
  onRangeSelect?: (oid: string) => void;
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
  onSelect,
  onRangeSelect,
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
      // Shift+点击按当前视图顺序做区间选择；Ctrl/Cmd+点击填对比槽；普通点击打开详情。
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
    [commitsByOid, cancelHover, onCtrlSelect, onRangeSelect, onSelect],
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

  // mouseenter / mouseleave 不冒泡，用容器级 mouseover 模拟换行语义：
  // 按 data-oid 判断是否进入新行，换行时先复刻旧行 mouseleave（关卡、作废旧请求），
  // 再对新行 queueHover；同一行内子元素间移动不重复触发。
  const handleListMouseOver = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const oid =
        (event.target as Element).closest("[data-oid]")?.getAttribute("data-oid") ?? null;
      if (oid === hoveredOidRef.current) {
        return;
      }
      hoveredOidRef.current = oid;
      cancelHover();
      const commit = oid ? commitsByOid.get(oid) : undefined;
      if (commit) {
        queueHover(event, commit);
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
  }, [cancelHover]);

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
              located={focusedOid === oid}
            />
          );
        })}
      </div>
      {loadingMore && <div className="graph-loading muted">{t("graph.loadingMore")}</div>}
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
