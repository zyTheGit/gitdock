import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummaryDto, RefBadgeDto } from "../../shared/types";
import { GraphCell } from "./GraphCell";
import type { GraphView } from "./model";

const ROW_HEIGHT = 34;
const LOAD_MORE_THRESHOLD = 12;

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(seconds: number): string {
  if (!seconds) {
    return "—";
  }
  return dateFormat.format(new Date(seconds * 1000));
}

function badgeClass(badge: RefBadgeDto): string {
  const parts = ["ref-badge", `ref-${badge.kind}`];
  if (badge.is_head) {
    parts.push("ref-head");
  }
  return parts.join(" ");
}

interface GraphListProps {
  view: GraphView;
  loading: boolean;
  loadingMore: boolean;
  selectedOid: string | null;
  focusedOid?: string | null;
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
  onSelect,
  onCtrlSelect,
  onContextMenu,
  onLoadMore,
}: GraphListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // 搜索结果定位：把目标行滚动到可视区域并保持高亮。
  useEffect(() => {
    if (!focusedOid) {
      return;
    }
    const index = view.rows.findIndex((row) => row.layout.oid === focusedOid);
    if (index < 0) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [focusedOid, view.rows, virtualizer]);

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
    <div className="graph-list" ref={scrollRef}>
      <div className="graph-list-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const row = view.rows[item.index];
          if (!row) {
            return null;
          }
          const commit = row.commit;
          const oid = commit?.oid ?? row.layout.oid;
          const classes = ["graph-row"];
          if (selectedOid === oid) {
            classes.push("selected");
          }
          if (focusedOid === oid) {
            classes.push("located");
          }
          return (
            <div
              key={item.key}
              className={classes.join(" ")}
              style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
              onClick={(event) => {
                // Ctrl / Cmd + 点击填对比槽；普通点击打开详情。
                if ((event.ctrlKey || event.metaKey) && commit && onCtrlSelect) {
                  event.preventDefault();
                  onCtrlSelect(commit);
                  return;
                }
                onSelect(oid);
              }}
              onContextMenu={(event) => {
                if (commit && onContextMenu) {
                  event.preventDefault();
                  onContextMenu(event, commit);
                }
              }}
            >
              <GraphCell layout={row.layout} laneCount={laneCount} height={ROW_HEIGHT} />
              <div className="graph-row-summary">
                <span className="commit-summary" title={commit?.summary}>
                  {commit?.summary || "（无提交说明）"}
                </span>
                {commit?.refs.map((badge) => (
                  <span
                    key={`${badge.kind}:${badge.name}`}
                    className={badgeClass(badge)}
                    title={`${badge.kind} · ${badge.name}`}
                  >
                    {badge.is_head ? "HEAD → " : ""}
                    {badge.name}
                  </span>
                ))}
              </div>
              <span className="graph-row-author" title={commit?.author_email}>
                {commit?.author_name ?? "—"}
              </span>
              <span className="graph-row-date">{formatDate(commit?.authored_at ?? 0)}</span>
              <span className="graph-row-oid mono">{commit?.short_oid ?? oid.slice(0, 7)}</span>
            </div>
          );
        })}
      </div>
      {loadingMore && <div className="graph-loading muted">加载更多…</div>}
    </div>
  );
}
