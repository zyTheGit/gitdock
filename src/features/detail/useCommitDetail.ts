import { useEffect, useState } from "react";
import { errorText } from "../../shared/error";
import { ipc } from "../../shared/ipc";
import type { CommitDetailDto, FileDiffDto } from "../../shared/types";

export interface DetailLoader<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// generation 参与依赖：仓库刷新后旧请求结果无法覆盖新视图。
export function useCommitDetail(
  oid: string | null,
  generation: number,
): DetailLoader<CommitDetailDto> {
  const [data, setData] = useState<CommitDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!oid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipc
      .readCommit(oid)
      .then((detail) => {
        if (!cancelled && detail.generation === generation) {
          setData(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [oid, generation]);

  return { data, loading, error };
}

export function useFileDiff(
  oid: string | null,
  path: string | null,
  generation: number,
): DetailLoader<FileDiffDto> {
  const [data, setData] = useState<FileDiffDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!oid || !path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipc
      .readFileDiff(oid, path)
      .then((diff) => {
        if (!cancelled && diff.generation === generation) {
          setData(diff);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorText(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [oid, path, generation]);

  return { data, loading, error };
}
