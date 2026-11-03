import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { scopeKey } from "../../shared/graphScope";
import { ipc } from "../../shared/ipc";
import type { GraphScope } from "../../shared/types";
import { appendPage, EMPTY_GRAPH_VIEW, startView, type GraphView } from "./model";

const PAGE_LIMIT = 200;

export interface GraphLoader {
  view: GraphView;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  reload: (options?: { keepRows?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  /** 载入包含指定提交的一页图谱；返回是否已切换到该页。 */
  jumpTo: (oid: string) => Promise<boolean>;
}

export function useGraph(repoPath: string | null, scope: GraphScope): GraphLoader {
  const [view, setView] = useState<GraphView>(EMPTY_GRAPH_VIEW);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef(0);
  const viewRef = useRef<GraphView>(view);
  const scopeRef = useRef(scope);
  const loadingMoreRef = useRef(false);
  scopeRef.current = scope;

  const commitView = useCallback((next: GraphView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const reload = useCallback(
    async (options?: { keepRows?: boolean }) => {
      if (!repoPath) {
        commitView(EMPTY_GRAPH_VIEW);
        setError(null);
        setLoading(false);
        return;
      }
      const current = ++token.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoading(true);
      setError(null);
      if (!options?.keepRows) {
        commitView(EMPTY_GRAPH_VIEW);
      }
      try {
        const page = await ipc.readGraphPage(scopeRef.current, null, PAGE_LIMIT);
        if (current !== token.current) {
          return;
        }
        commitView(startView(page));
      } catch (err) {
        if (current !== token.current) {
          return;
        }
        setError(errorText(err));
      } finally {
        if (current === token.current) {
          setLoading(false);
        }
      }
    },
    [commitView, repoPath],
  );

  const loadMore = useCallback(async () => {
    const currentView = viewRef.current;
    if (loadingMoreRef.current || !currentView.hasMore || !currentView.nextCursor) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const current = token.current;
    try {
      const page = await ipc.readGraphPage(
        scopeRef.current,
        currentView.nextCursor,
        PAGE_LIMIT,
      );
      if (current !== token.current) {
        return;
      }
      const merged = appendPage(viewRef.current, page);
      if (merged) {
        commitView(merged);
      } else {
        // generation / view_key 已变化：放弃追加，等待显式刷新。
        setError(null);
      }
    } catch (err) {
      if (current !== token.current) {
        return;
      }
      setError(errorText(err));
    } finally {
      if (current === token.current) {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [commitView]);

  const jumpTo = useCallback(
    async (oid: string) => {
      if (!repoPath) {
        return false;
      }
      const current = ++token.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoading(true);
      setError(null);
      try {
        const page = await ipc.readGraphPageAround(scopeRef.current, oid, PAGE_LIMIT);
        if (current !== token.current) {
          return false;
        }
        commitView(startView(page));
        return true;
      } catch (err) {
        if (current !== token.current) {
          return false;
        }
        setError(errorText(err));
        return false;
      } finally {
        if (current === token.current) {
          setLoading(false);
        }
      }
    },
    [commitView, repoPath],
  );

  useEffect(() => {
    void reload();
    return () => {
      // 视图或仓库切换后，旧请求的结果不得写入新状态。
      token.current += 1;
    };
  }, [reload, scopeKey(scope)]);

  return { view, loading, loadingMore, error, reload, loadMore, jumpTo };
}
