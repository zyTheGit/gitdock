import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ipc } from "../../shared/ipc";
import type { CommitBranchContextDto, CommitSummaryDto, RefBadgeDto } from "../../shared/types";
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

/** 悬浮卡：参考 Git Graph，在不点击的情况下给出提交的完整元信息与分支差异。 */
function CommitHoverCard({
  commit,
  x,
  y,
  context,
  contextLoading,
}: {
  commit: CommitSummaryDto;
  x: number;
  y: number;
  context: CommitBranchContextDto | null;
  contextLoading: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const width = 380;
  const left = Math.max(8, Math.min(x + 18, window.innerWidth - width - 12));
  const [top, setTop] = useState(() => Math.max(8, Math.min(y + 14, window.innerHeight - 260)));
  // 分支差异返回后卡片会变高，按实际高度重新夹取，避免超出窗口底部。
  useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(y + 14, window.innerHeight - height - 12)));
  }, [y, context, contextLoading]);
  const branches = commit.refs.filter(
    (ref) => ref.kind === "local_branch" || ref.kind === "remote_branch",
  );
  const tags = commit.refs.filter((ref) => ref.kind === "tag");
  const currentLabel = context?.current_branch ?? "HEAD";
  const branchNames = context
    ? context.branches.map((name) => (name === context.current_branch ? `${name}（当前）` : name))
    : [];
  const shownNames = branchNames.slice(0, 8);
  const hiddenNames = branchNames.length - shownNames.length;
  return (
    <div
      ref={cardRef}
      className="commit-hover-card"
      style={{ left, top, width }}
      role="tooltip"
    >
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
      {contextLoading && <p className="hover-status muted">正在统计所属分支与差异…</p>}
      {context && (
        <div className="hover-branches">
          <p className="hover-branch-line">
            <span className="hover-label">所属分支</span>
            {branchNames.length === 0
              ? "无本地分支"
              : `${shownNames.join("、")}${hiddenNames > 0 ? ` 等 ${branchNames.length} 个` : ""}`}
          </p>
          {context.current_branch &&
            !context.branches.includes(context.current_branch) && (
              <p className="hover-off-branch">
                该提交不在当前分支 {context.current_branch}
              </p>
            )}
          {context.gaps.length > 0 && (
            <>
              <p className="hover-branch-line">
                <span className="hover-label">相对 {currentLabel}</span> <span className="muted">本地分支</span>
              </p>
              {context.gaps.map((gap) => (
                <div className="hover-gap" key={gap.name}>
                  <div className="hover-gap-head">
                    <span className="hover-gap-name">{gap.name}</span>
                    <span className="hover-gap-count muted">
                      当前分支缺少 {gap.branch_only} · 该分支缺少 {gap.head_only}
                    </span>
                  </div>
                  {gap.branch_only_commits.length > 0 && (
                    <p className="hover-gap-commits">
                      缺少：
                      {gap.branch_only_commits
                        .map((item) => `${item.short_oid} ${item.summary || "（无说明）"}`)
                        .join("、")}
                      {gap.branch_only_truncated ? " …" : ""}
                    </p>
                  )}
                  {gap.head_only_commits.length > 0 && (
                    <p className="hover-gap-commits muted">
                      该分支缺少：
                      {gap.head_only_commits
                        .map((item) => `${item.short_oid} ${item.summary || "（无说明）"}`)
                        .join("、")}
                      {gap.head_only_truncated ? " …" : ""}
                    </p>
                  )}
                </div>
              ))}
              {context.gaps_omitted > 0 && (
                <p className="hover-status muted">
                  另有 {context.gaps_omitted} 个分支未参与统计
                </p>
              )}
            </>
          )}
        </div>
      )}
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
  const [hover, setHover] = useState<{
    commit: CommitSummaryDto;
    x: number;
    y: number;
    context: CommitBranchContextDto | null;
    contextLoading: boolean;
  } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const branchContextCache = useRef(new Map<string, CommitBranchContextDto>());
  const branchContextSeq = useRef(0);

  // 分支差异按提交缓存；仓库刷新（viewKey 变化）后丢弃。
  useEffect(() => {
    branchContextCache.current.clear();
    branchContextSeq.current += 1;
  }, [view.viewKey]);

  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    branchContextSeq.current += 1;
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
      const cached = branchContextCache.current.get(commit.oid) ?? null;
      setHover({ commit, x, y, context: cached, contextLoading: cached === null });
      if (cached) {
        return;
      }
      const seq = ++branchContextSeq.current;
      void ipc
        .commitBranchContext(commit.oid, 2)
        .then((context) => {
          branchContextCache.current.set(commit.oid, context);
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover((current) =>
            current && current.commit.oid === commit.oid
              ? { ...current, context, contextLoading: false }
              : current,
          );
        })
        .catch(() => {
          if (seq !== branchContextSeq.current) {
            return;
          }
          setHover((current) =>
            current && current.commit.oid === commit.oid
              ? { ...current, contextLoading: false }
              : current,
          );
        });
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
