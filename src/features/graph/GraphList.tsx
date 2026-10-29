import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
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

function refLabel(ref: RefBadgeDto): string {
  const name = ref.is_head ? `${ref.name}（HEAD）` : ref.name;
  return ref.description ? `${name} — ${ref.description}` : name;
}

/** 悬浮卡：参考 Git Graph，在不点击的情况下给出提交的完整元信息。 */
function CommitHoverCard({ commit, x, y }: { commit: CommitSummaryDto; x: number; y: number }) {
  const width = 380;
  const left = Math.max(8, Math.min(x + 18, window.innerWidth - width - 12));
  const top = Math.max(8, Math.min(y + 14, window.innerHeight - 260));
  const branches = commit.refs.filter(
    (ref) => ref.kind === "local_branch" || ref.kind === "remote_branch",
  );
  const tags = commit.refs.filter((ref) => ref.kind === "tag");
  return (
    <div className="commit-hover-card" style={{ left, top, width }} role="tooltip">
      <div className="hover-head">
        <span className="mono">提交 {commit.short_oid}</span>
        {commit.refs.some((ref) => ref.is_head) && <span className="tag">HEAD</span>}
      </div>
      <p className="hover-summary">{commit.summary || "（无提交说明）"}</p>
      <dl>
        {branches.length > 0 && (
          <>
            <dt>分支</dt>
            <dd>{branches.map(refLabel).join("、")}</dd>
          </>
        )}
        {tags.length > 0 && (
          <>
            <dt>标签</dt>
            <dd>{tags.map(refLabel).join("、")}</dd>
          </>
        )}
        <dt>父提交</dt>
        <dd className="mono">
          {commit.parents.length > 0
            ? commit.parents.map((oid) => oid.slice(0, 7)).join(" · ")
            : "无（根提交）"}
        </dd>
        <dt>作者</dt>
        <dd>
          {commit.author_name} &lt;{commit.author_email}&gt;
        </dd>
        <dt>提交时间</dt>
        <dd>{formatDate(commit.committed_at)}</dd>
        {commit.authored_at !== commit.committed_at && (
          <>
            <dt>作者时间</dt>
            <dd>{formatDate(commit.authored_at)}</dd>
          </>
        )}
      </dl>
      <p className="hover-hint muted">点击行查看详情与文件改动</p>
    </div>
  );
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
  const [hover, setHover] = useState<{
    commit: CommitSummaryDto;
    x: number;
    y: number;
  } | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHover(null);
  }, []);

  // 短暂停留后再显示，避免快速划过时频繁弹卡。
  const queueHover = useCallback((event: MouseEvent, commit: CommitSummaryDto) => {
    const { clientX: x, clientY: y } = event;
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setHover({ commit, x, y });
    }, 260);
  }, []);

  useEffect(() => cancelHover, [cancelHover]);

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
    <div className="graph-list" ref={scrollRef} onScroll={cancelHover}>
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
                cancelHover();
                // Ctrl / Cmd + 点击填对比槽；普通点击打开详情。
                if ((event.ctrlKey || event.metaKey) && commit && onCtrlSelect) {
                  event.preventDefault();
                  onCtrlSelect(commit);
                  return;
                }
                onSelect(oid);
              }}
              onContextMenu={(event) => {
                cancelHover();
                if (commit && onContextMenu) {
                  event.preventDefault();
                  onContextMenu(event, commit);
                }
              }}
              onMouseEnter={(event) => {
                if (commit) {
                  queueHover(event, commit);
                }
              }}
              onMouseLeave={cancelHover}
            >
              <GraphCell layout={row.layout} laneCount={laneCount} height={ROW_HEIGHT} />
              <div className="graph-row-summary">
                <span className="commit-summary">{commit?.summary || "（无提交说明）"}</span>
                {commit?.refs.map((badge) => (
                  <span className="ref-group" key={`${badge.kind}:${badge.name}`}>
                    <span className={badgeClass(badge)}>
                      {badge.is_head ? "HEAD → " : ""}
                      {badge.name}
                    </span>
                    {badge.description && (
                      <span className="ref-desc">{badge.description}</span>
                    )}
                  </span>
                ))}
              </div>
              <span className="graph-row-author">{commit?.author_name ?? "—"}</span>
              <span className="graph-row-date">{formatDate(commit?.authored_at ?? 0)}</span>
              <span className="graph-row-oid mono">{commit?.short_oid ?? oid.slice(0, 7)}</span>
            </div>
          );
        })}
      </div>
      {loadingMore && <div className="graph-loading muted">加载更多…</div>}
      {hover && <CommitHoverCard commit={hover.commit} x={hover.x} y={hover.y} />}
    </div>
  );
}
