import { useCallback, useEffect, useRef, useState } from "react";
import { i18next } from "../../i18n";
import { errorText } from "../../shared/error";
import { scopeKey } from "../../shared/graphScope";
import { ipc } from "../../shared/ipc";
import type { GraphScope, SearchDateRange, SearchMatchDto } from "../../shared/types";

export interface SearchLoader {
  results: SearchMatchDto[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  canceled: boolean;
  text: string;
  dateRange: SearchDateRange | null;
  start: (text: string, dateRange?: SearchDateRange | null) => void;
  loadMore: () => void;
  cancel: () => void;
  reset: () => void;
}

let searchSeq = 0;

export function useSearch(repoGeneration: number, scope: GraphScope): SearchLoader {
  const [results, setResults] = useState<SearchMatchDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [text, setText] = useState("");
  const [dateRange, setDateRange] = useState<SearchDateRange | null>(null);

  const token = useRef(0);
  const searchId = useRef<string | null>(null);
  const cursor = useRef<string | null>(null);
  const textRef = useRef("");
  const dateRangeRef = useRef<SearchDateRange | null>(null);
  const scopeRef = useRef(scope);
  const generationRef = useRef(repoGeneration);
  scopeRef.current = scope;
  generationRef.current = repoGeneration;

  const reset = useCallback(() => {
    token.current += 1;
    searchId.current = null;
    cursor.current = null;
    textRef.current = "";
    dateRangeRef.current = null;
    setResults([]);
    setLoading(false);
    setLoadingMore(false);
    setError(null);
    setHasMore(false);
    setCanceled(false);
    setText("");
    setDateRange(null);
  }, []);

  // 切换范围或仓库 generation 变化后，旧搜索游标已经失效。
  useEffect(() => {
    reset();
  }, [reset, repoGeneration, scopeKey(scope)]);

  const start = useCallback((value: string, range: SearchDateRange | null = null) => {
    const trimmed = value.trim();
    if (!trimmed) {
      reset();
      return;
    }
    const id = `search-${Date.now()}-${++searchSeq}`;
    const current = ++token.current;
    searchId.current = id;
    cursor.current = null;
    textRef.current = trimmed;
    dateRangeRef.current = range;
    setText(trimmed);
    setDateRange(range);
    setResults([]);
    setError(null);
    setHasMore(false);
    setCanceled(false);
    setLoading(true);
    ipc
      .search(
        { search_id: id, scope: scopeRef.current, text: trimmed, highlight: trimmed, date_range: range },
        null,
      )
      .then((page) => {
        if (current !== token.current) {
          return;
        }
        if (page.generation !== generationRef.current) {
          setError(i18next.t("search.repoChanged"));
          setHasMore(false);
          return;
        }
        setResults(page.results);
        cursor.current = page.next_cursor ?? null;
        setHasMore(page.has_more);
        setCanceled(page.canceled);
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
  }, [reset]);

  const loadMore = useCallback(() => {
    const id = searchId.current;
    if (!id || !cursor.current || loading || loadingMore) {
      return;
    }
    const current = token.current;
    setLoadingMore(true);
    ipc
      .search(
        {
          search_id: id,
          scope: scopeRef.current,
          text: textRef.current,
          highlight: textRef.current,
          date_range: dateRangeRef.current,
        },
        cursor.current,
      )
      .then((page) => {
        if (current !== token.current) {
          return;
        }
        if (page.generation !== generationRef.current) {
          setError(i18next.t("search.repoChanged"));
          setHasMore(false);
          return;
        }
        setResults((existing) => existing.concat(page.results));
        cursor.current = page.next_cursor ?? null;
        setHasMore(page.has_more);
        setCanceled(page.canceled);
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
  }, [loading, loadingMore]);

  const cancel = useCallback(() => {
    token.current += 1;
    const id = searchId.current;
    setLoading(false);
    setLoadingMore(false);
    setCanceled(true);
    setHasMore(false);
    if (id) {
      void ipc.cancelSearch(id).catch(() => undefined);
    }
  }, []);

  return {
    results,
    loading,
    loadingMore,
    error,
    hasMore,
    canceled,
    text,
    dateRange,
    start,
    loadMore,
    cancel,
    reset,
  };
}
