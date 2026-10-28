import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../shared/error";
import { CommandError, ipc } from "../../shared/ipc";
import type {
  CommitSummaryDto,
  CompareResultDto,
  FileDiffDto,
  RepoStateDto,
} from "../../shared/types";

export interface CompareSlot {
  oid: string;
  label: string;
}

export type CompareSide = "base" | "compare";

export function commitSlot(commit: CommitSummaryDto): CompareSlot {
  const badge =
    commit.refs.find((ref) => ref.is_head) ??
    commit.refs.find((ref) => ref.kind === "local_branch") ??
    commit.refs[0];
  return { oid: commit.oid, label: badge?.name ?? commit.short_oid };
}

function headSlot(repo: RepoStateDto | null): CompareSlot | null {
  if (!repo?.head.oid) {
    return null;
  }
  return {
    oid: repo.head.oid,
    label: repo.head.kind === "branch" ? repo.head.branch ?? "HEAD" : "detached HEAD",
  };
}

const REF_ERRORS = new Set(["ref_not_found", "ref_unresolved", "repository_not_found"]);

export function useCompareSlots(repo: RepoStateDto | null) {
  const [base, setBase] = useState<CompareSlot | null>(null);
  const [compare, setCompare] = useState<CompareSlot | null>(null);
  const [pending, setPending] = useState<CompareSlot | null>(null);
  const repoPath = repo?.path ?? null;

  // 打开仓库时 Base 固定为该时刻的 HEAD OID；后续刷新不改变已填槽位。
  useEffect(() => {
    setBase(headSlot(repo));
    setCompare(null);
    setPending(null);
  }, [repoPath]);

  const ctrlSelect = useCallback(
    (commit: CommitSummaryDto) => {
      const value = commitSlot(commit);
      if (!compare) {
        setCompare(value);
      } else if (!base) {
        setBase(value);
      } else if (value.oid !== base.oid && value.oid !== compare.oid) {
        setPending(value);
      }
    },
    [base, compare],
  );

  const resolvePending = useCallback(
    (side: CompareSide | null) => {
      if (side && pending) {
        if (side === "base") {
          setBase(pending);
        } else {
          setCompare(pending);
        }
      }
      setPending(null);
    },
    [pending],
  );

  const swap = useCallback(() => {
    setBase(compare);
    setCompare(base);
  }, [base, compare]);

  const clear = useCallback((side: CompareSide) => {
    if (side === "base") {
      setBase(null);
    } else {
      setCompare(null);
    }
  }, []);

  const setSide = useCallback((side: CompareSide, slot: CompareSlot) => {
    if (side === "base") {
      setBase(slot);
    } else {
      setCompare(slot);
    }
  }, []);

  const clearAll = useCallback(() => {
    setBase(null);
    setCompare(null);
    setPending(null);
  }, []);

  // Esc：先取消待替换，再清空对比槽。
  const escape = useCallback(() => {
    if (pending) {
      setPending(null);
    } else {
      clearAll();
    }
  }, [pending, clearAll]);

  return {
    base,
    compare,
    pending,
    ctrlSelect,
    resolvePending,
    swap,
    clear,
    setSide,
    clearAll,
    escape,
  };
}

export interface CompareLoader {
  result: CompareResultDto | null;
  loading: boolean;
  error: string | null;
  invalidRef: boolean;
}

export function useCompareResult(
  base: CompareSlot | null,
  compare: CompareSlot | null,
  generation: number,
  pathFilter: string,
): CompareLoader {
  const [result, setResult] = useState<CompareResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidRef, setInvalidRef] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setResult(null);
    setError(null);
    setInvalidRef(false);
    if (!base || !compare) {
      setLoading(false);
      return;
    }
    const current = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      ipc
        .compare(base.oid, compare.oid, pathFilter.trim() || undefined)
        .then((next) => {
          if (current !== seq.current) {
            return;
          }
          if (next.generation !== generation) {
            setError("仓库状态已变化，请刷新后重试对比");
            return;
          }
          setResult(next);
        })
        .catch((err) => {
          if (current !== seq.current) {
            return;
          }
          const code = err instanceof CommandError ? err.code : "";
          setInvalidRef(REF_ERRORS.has(code));
          setError(
            REF_ERRORS.has(code)
              ? "引用已无法解析，请重新选择 Base / Compare"
              : errorText(err),
          );
        })
        .finally(() => {
          if (current === seq.current) {
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
    };
  }, [base?.oid, compare?.oid, generation, pathFilter]);

  return { result, loading, error, invalidRef };
}

export function useCompareFileDiff(
  base: CompareSlot | null,
  compare: CompareSlot | null,
  path: string | null,
  generation: number,
): { data: FileDiffDto | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<FileDiffDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!base || !compare || !path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipc
      .compareFileDiff(base.oid, compare.oid, path)
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
  }, [base?.oid, compare?.oid, path, generation]);

  return { data, loading, error };
}
