import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "../../i18n";
import { STATUS_LETTER } from "../../shared/fileStatus";
import { formatDate } from "../../shared/format";
import { ipc } from "../../shared/ipc";
import { useIpcResource } from "../../shared/useIpcResource";
import type { FileHistoryEntryDto } from "../../shared/types";
import { FileDiffView } from "../diff/FileDiffView";
import { useIgnoreWhitespace } from "../diff/diffOptions";
import { useFileHistory } from "./useFileHistory";

// 固定行高（状态 + 元信息 + 摘要两行），摘要靠省略号截断，不参与测量。
const ENTRY_HEIGHT = 50;
const ENTRY_OVERSCAN = 10;

interface FileHistoryViewProps {
  path: string;
  oid: string;
  generation: number;
  /** 定位提交：关闭对话框并在图谱中选中。 */
  onLocate: (oid: string) => void;
}

/**
 * 单文件提交历史：左侧虚拟化时间线，右侧显示选中提交对该文件的改动。
 *
 * 根提交没有父提交可对比，改用 `read_file_diff`（后端与空树比较）；
 * 其余提交用 `compare_file_diff(第一父, 提交)`。「对比相邻版本」把基线换成
 * 时间线里的下一条（更早的一次改动），并按两点快照对比，避免 merge-base
 * 把两次改动之间的内容吞掉。
 */
export function FileHistoryView({ path, oid, generation, onLocate }: FileHistoryViewProps) {
  const { t } = useI18n();
  const history = useFileHistory(path, oid, generation);
  const entries = history.entries;
  const [selected, setSelected] = useState<string | null>(null);
  const [adjacent, setAdjacent] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ignoreWhitespace] = useIgnoreWhitespace();

  // 默认选中最新一条（列表本身按拓扑序从新到旧）；翻页换目标时重选。
  useEffect(() => {
    if (entries.length === 0) {
      return;
    }
    if (!entries.some((entry) => entry.commit.oid === selected)) {
      setSelected(entries[0].commit.oid);
      setAdjacent(false);
    }
  }, [entries, selected]);

  const index = Math.max(
    0,
    entries.findIndex((entry) => entry.commit.oid === selected),
  );
  const entry: FileHistoryEntryDto | null = entries[index] ?? null;
  const previous = entries[index + 1] ?? null;
  const isRoot = entry !== null && entry.commit.parents.length === 0;
  const twoDot = adjacent && previous !== null && !isRoot;
  const baseOid = twoDot ? previous.commit.oid : entry?.commit.parents[0] ?? null;

  const diff = useIpcResource(
    [entry?.commit.oid, baseOid, twoDot, path, ignoreWhitespace],
    () =>
      isRoot
        ? ipc.readFileDiff(entry!.commit.oid, path, ignoreWhitespace)
        : ipc.compareFileDiff(baseOid!, entry!.commit.oid, path, twoDot, ignoreWhitespace),
    { enabled: entry !== null && (isRoot || baseOid !== null), expectedGeneration: generation },
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ENTRY_HEIGHT,
    overscan: ENTRY_OVERSCAN,
    getItemKey: (item) => entries[item]?.commit.oid ?? item,
  });

  // 滚到末尾自动续页：`range.endIndex` 随滚动变化；loadingMore 自身互斥，
  // 连续空页（文件很久没改）会在此逐页推进，直到命中或到达历史上限。
  const loadMore = history.loadMore;
  const lastVisible = virtualizer.range?.endIndex ?? -1;
  useEffect(() => {
    if (history.hasMore && lastVisible >= entries.length - 1) {
      loadMore();
    }
  }, [entries.length, history.hasMore, lastVisible, loadMore]);

  return (
    <div className="file-history-view">
      <div className="file-history-timeline" aria-label={t("history.timelineLabel")}>
        {history.error && <div className="banner danger compact">{history.error}</div>}
        {history.loading ? (
          <p className="muted history-placeholder">{t("history.loadingHistory")}</p>
        ) : entries.length === 0 ? (
          history.hasMore ? null : (
            <p className="muted history-placeholder">{t("history.emptyHistory")}</p>
          )
        ) : (
          <div className="file-history-scroll" ref={scrollRef}>
            <ul className="file-history-list" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = entries[item.index];
                if (!row) {
                  return null;
                }
                return (
                  <li
                    key={item.key}
                    style={{
                      height: ENTRY_HEIGHT,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <button
                      type="button"
                      className={
                        row.commit.oid === entry?.commit.oid
                          ? "history-entry active"
                          : "history-entry"
                      }
                      onClick={() => setSelected(row.commit.oid)}
                      title={row.commit.summary}
                    >
                      <span className={`file-status file-status-${row.status}`}>
                        {STATUS_LETTER[row.status]}
                      </span>
                      <span className="history-entry-main">
                        <span className="history-entry-meta muted">
                          <span>{formatDate(row.commit.authored_at)}</span>
                          <span className="mono">{row.commit.short_oid}</span>
                          <span className="history-entry-author">{row.commit.author_name}</span>
                        </span>
                        <span className="history-entry-summary">{row.commit.summary}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {history.hasMore && (
          <div className="file-history-more">
            <button type="button" onClick={loadMore} disabled={history.loadingMore}>
              {history.loadingMore ? t("history.loadingMore") : t("history.loadMore")}
            </button>
          </div>
        )}
      </div>

      <div className="history-diff">
        <div className="history-detail-head">
          <span className="mono">{entry?.commit.short_oid ?? ""}</span>
          <span className="history-detail-summary muted" title={entry?.commit.summary}>
            {entry?.commit.summary ?? ""}
          </span>
          <span className="history-detail-actions">
            <button
              type="button"
              disabled={!entry}
              onClick={() => entry && onLocate(entry.commit.oid)}
            >
              {t("history.locateCommit")}
            </button>
            <button
              type="button"
              disabled={!previous || isRoot}
              aria-pressed={twoDot}
              onClick={() => setAdjacent((current) => !current)}
            >
              {twoDot ? t("history.compareSingle") : t("history.compareAdjacent")}
            </button>
          </span>
        </div>
        {twoDot && entry && previous && (
          <p className="history-adjacent-note muted">
            {t("history.adjacentPair", {
              from: previous.commit.short_oid,
              to: entry.commit.short_oid,
            })}
          </p>
        )}
        <div className="history-diff-body">
          {diff.loading && <p className="muted">{t("history.loadingDiff")}</p>}
          {diff.error && <div className="banner danger compact">{diff.error}</div>}
          {diff.data && (
            <FileDiffView
              key={entry?.commit.oid}
              diff={diff.data}
              expanded={expanded}
              onExpandedChange={setExpanded}
              loading={diff.loading}
              sideLabels={
                entry
                  ? {
                      left:
                        twoDot && previous
                          ? t("diff.sideCommit", { oid: previous.commit.short_oid })
                          : isRoot
                            ? t("diff.sideEmpty")
                            : t("diff.sideParentGeneric"),
                      right: t("diff.sideCommit", { oid: entry.commit.short_oid }),
                    }
                  : undefined
              }
            />
          )}
          {!entry && !diff.loading && !diff.error && (
            <p className="muted">{t("history.selectEntryHint")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
