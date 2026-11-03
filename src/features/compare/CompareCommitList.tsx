import { useRef, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatDate } from "../../shared/format";
import type { CommitSummaryDto } from "../../shared/types";

// 提交行高度初值（12px 文本 + 上下 padding）；文本行高随字体而定，
// 首帧后由 measureElement 按实际渲染高度修正。
const COMMIT_ROW_ESTIMATE = 28;
const COMMIT_LIST_OVERSCAN = 10;

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
  const scrollRef = useRef<HTMLDivElement>(null);
  // 对比提交列表虚拟化：大范围对比数千提交时只渲染可视行。
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COMMIT_ROW_ESTIMATE,
    overscan: COMMIT_LIST_OVERSCAN,
    getItemKey: (index) => commits[index]?.oid ?? index,
  });

  return (
    <div className="compare-commits">
      <h3>
        Compare 引入的提交（{commits.length}
        {truncated ? "+" : ""}）
      </h3>
      {commits.length === 0 ? (
        <p className="muted">Compare 没有相对共同祖先的新提交。</p>
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
