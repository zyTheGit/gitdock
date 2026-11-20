import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { FileHistoryEntryDto } from "../../shared/types";
import { useIpcResource } from "../../shared/useIpcResource";

export interface FileHistoryLoader {
  entries: FileHistoryEntryDto[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * 单文件历史分页加载（ADR-0031）：cursor 由后端不透明生成，前端只负责续页与
 * 去重；`generation` 参与依赖并在响应里复核，仓库刷新后旧页直接丢弃。
 *
 * `oid` 作为起点提交（`oid_or_scope`）传入：历史从该提交（含）沿第一父/拓扑
 * 序列向前追溯，与图谱当前的提交保持同一锚点。
 */
export function useFileHistory(path: string, oid: string, generation: number): FileHistoryLoader {
  const [entries, setEntries] = useState<FileHistoryEntryDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 首屏与续页共享同一个令牌：目标/仓库变化时旧响应整体作废。
  const token = useRef(0);

  useEffect(() => {
    const current = ++token.current;
    setEntries([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    ipc
      .readFileHistory(path, oid, null)
      .then((page) => {
        if (current !== token.current || page.generation !== generation) {
          return;
        }
        setEntries(page.entries);
        setCursor(page.next_cursor ?? null);
        setHasMore(page.has_more);
      })
      .catch((err) => {
        if (current === token.current) {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (current === token.current) {
          setLoading(false);
        }
      });
  }, [path, oid, generation]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || !cursor) {
      return;
    }
    const current = token.current;
    setLoadingMore(true);
    ipc
      .readFileHistory(path, oid, cursor)
      .then((page) => {
        if (current !== token.current || page.generation !== generation) {
          return;
        }
        // 续页按追加合并：同一提交不会被后端重复发出，这里不再逐条去重。
        setEntries((previous) => [...previous, ...page.entries]);
        setCursor(page.next_cursor ?? null);
        setHasMore(page.has_more);
      })
      .catch((err) => {
        if (current === token.current) {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (current === token.current) {
          setLoadingMore(false);
        }
      });
  }, [cursor, generation, hasMore, loading, loadingMore, oid, path]);

  return { entries, loading, loadingMore, error, hasMore, loadMore };
}

/** 行级追溯：单请求资源，二进制/超大文件由 DTO 标记降级，不走错误态。 */
export function useFileBlame(path: string, oid: string, generation: number) {
  return useIpcResource([path, oid], () => ipc.readFileBlame(oid, path), {
    expectedGeneration: generation,
  });
}
