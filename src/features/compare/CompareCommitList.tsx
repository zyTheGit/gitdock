import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto } from "../../shared/types";

// 提交行高度初值（12px 文本 + 上下 padding）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const COMMIT_ROW_ESTIMATE = 28;
const COMMIT_LIST_OVERSCAN = 10;
const DEFAULT_HEIGHT = 160;
const MIN_HEIGHT = 96;
const MAX_HEIGHT_RATIO = 0.7;

interface CompareCommitListProps {
  commits: CommitSummaryDto[];
  truncated: boolean;
  onOpen: (oid: string) => void;
  onContextMenu: (event: MouseEvent, commit: CommitSummaryDto) => void;
}

export function CompareCommitList({
  commits,
  truncated,
  onOpen,
  onContextMenu,
}: CompareCommitListProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [dragging, setDragging] = useState(false);

  const maxHeight = () => Math.max(
    MIN_HEIGHT,
    Math.floor(
      (containerRef.current?.parentElement?.clientHeight ?? window.innerHeight) *
        MAX_HEIGHT_RATIO,
    ),
  );
  const clampHeight = (value: number) =>
    Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(value)));

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height };
    setDragging(true);
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) {
      return;
    }
    setHeight(clampHeight(state.startHeight + state.startY - event.clientY));
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    const step = (event.shiftKey ? 40 : 12) * (event.key === "ArrowUp" ? 1 : -1);
    setHeight(clampHeight(height + step));
  };

  // 对比提交列表虚拟化：大范围对比数千提交时只渲染可视行。
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMMIT_ROW_ESTIMATE,
    overscan: COMMIT_LIST_OVERSCAN,
    getItemKey: (index) => commits[index]?.oid ?? index,
  });

  return (
    <div className="compare-commits" ref={containerRef} style={{ height }}>
      <div
        className={dragging ? "compare-commits-resizer dragging" : "compare-commits-resizer"}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("compare.resizeHandle")}
        aria-valuenow={height}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maxHeight()}
        tabIndex={0}
        title={t("compare.resizeHint")}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={onResizeKeyDown}
        onDoubleClick={() => setHeight(clampHeight(DEFAULT_HEIGHT))}
      />
      <h3>
        {truncated
          ? t("compare.commitsIntroducedTruncated", { n: commits.length })
          : t("compare.commitsIntroduced", { n: commits.length })}
      </h3>
      {commits.length === 0 ? (
        <p className="muted">{t("compare.noNewCommits")}</p>
      ) : (
        <div className="compare-commit-list" ref={scrollRef}>
          <ul
            className="compare-commit-inner"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const commit = commits[item.index];
              if (!commit) {
                return null;
              }
              return (
                <li
                  key={item.key}
                  data-index={item.index}
                  ref={(node) => virtualizer.measureElement(node)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <button
                    onClick={() => onOpen(commit.oid)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onContextMenu(event, commit);
                    }}
                    title={commit.oid}
                  >
                    <span className="compare-commit-summary">{commit.summary}</span>
                    <span className="mono muted">{commit.short_oid}</span>
                    <span className="muted">{formatDate(commit.authored_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
