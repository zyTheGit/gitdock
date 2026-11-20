import { useCallback, useEffect, useRef, useState } from "react";
import { i18next } from "../../i18n";
import { errorText } from "../../shared/error";
import { CommandError, ipc } from "../../shared/ipc";
import { useIpcResource } from "../../shared/useIpcResource";
import { useIgnoreWhitespace } from "../diff/diffOptions";
import type {
  CommitSummaryDto,
  CompareResultDto,
  FileDiffDto,
  RepoId,
  RepoStateDto,
} from "../../shared/types";

export interface CompareSlot {
  oid: string;
  label: string;
}

export type CompareSide = "base" | "compare";

/** 保留字：对比端点指向当前工作区（ADR-0030）；两侧不能同为它。 */
export const WORKTREE_OID = "worktree";

export function isWorktreeSlot(slot: CompareSlot | null): boolean {
  return slot?.oid === WORKTREE_OID;
}

/** 当前工作区槽位；标签由调用方按界面语言传入。 */
export function worktreeSlot(t: (key: "compare.slotWorktree") => string): CompareSlot {
  return { oid: WORKTREE_OID, label: t("compare.slotWorktree") };
}

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

/** 单个标签的对比槽位快照；pending 是瞬态，不跨标签保存。 */
interface SlotsSnapshot {
  base: CompareSlot | null;
  compare: CompareSlot | null;
}

interface SlotsState extends SlotsSnapshot {
  /** 槽位归属的标签 id；null 表示尚未绑定标签（欢迎页或首帧）。 */
  key: RepoId | null;
  pending: CompareSlot | null;
}

/**
 * 对比槽位（ADR-0032）：传入 tabKey 时按标签在内存中保存 Base / Compare，
 * 切换标签先快照当前标签再恢复目标标签；未传 tabKey 保持旧的单仓库语义。
 */
export function useCompareSlots(repo: RepoStateDto | null, tabKey: RepoId | null = null) {
  const [state, setState] = useState<SlotsState>(() => ({
    key: tabKey,
    base: headSlot(repo),
    compare: null,
    pending: null,
  }));
  const saved = useRef(new Map<RepoId, SlotsSnapshot>());
  const repoPath = repo?.path ?? null;

  // 标签切换时在渲染期同步换槽位：若等到 effect，会先用旧槽位对新 generation
  // 发起一次对比请求，再把结果覆盖掉。
  if (state.key !== tabKey && tabKey !== null) {
    if (state.key !== null) {
      saved.current.set(state.key, { base: state.base, compare: state.compare });
    }
    const restored = saved.current.get(tabKey);
    setState({
      key: tabKey,
      base: restored ? restored.base : headSlot(repo),
      compare: restored ? restored.compare : null,
      pending: null,
    });
  }

  const { base, compare, pending } = state;

  // 未绑定标签（欢迎页）时沿用旧语义：仓库路径变化即重置槽位。
  useEffect(() => {
    if (tabKey !== null) {
      return;
    }
    setState({ key: null, base: headSlot(repo), compare: null, pending: null });
  }, [repoPath, tabKey]);

  /** 标签关闭后丢弃其槽位；关闭的是当前标签时先清空，避免再被写回快照表。 */
  const forgetTab = useCallback((repoId: RepoId) => {
    saved.current.delete(repoId);
    setState((prev) =>
      prev.key === repoId
        ? { key: null, base: null, compare: null, pending: null }
        : prev,
    );
  }, []);

  const ctrlSelect = useCallback((commit: CommitSummaryDto) => {
    const value = commitSlot(commit);
    setState((prev) => {
      if (!prev.compare) {
        return { ...prev, compare: value };
      }
      if (!prev.base) {
        return { ...prev, base: value };
      }
      if (value.oid === prev.base.oid || value.oid === prev.compare.oid) {
        return prev;
      }
      return { ...prev, pending: value };
    });
  }, []);

  const resolvePending = useCallback((side: CompareSide | null) => {
    setState((prev) => {
      if (!side || !prev.pending) {
        return { ...prev, pending: null };
      }
      return side === "base"
        ? { ...prev, base: prev.pending, pending: null }
        : { ...prev, compare: prev.pending, pending: null };
    });
  }, []);

  const swap = useCallback(() => {
    setState((prev) => ({ ...prev, base: prev.compare, compare: prev.base }));
  }, []);

  const clear = useCallback((side: CompareSide) => {
    setState((prev) =>
      side === "base" ? { ...prev, base: null } : { ...prev, compare: null },
    );
  }, []);

  const setSide = useCallback((side: CompareSide, slot: CompareSlot) => {
    setState((prev) =>
      side === "base" ? { ...prev, base: slot } : { ...prev, compare: slot },
    );
  }, []);

  const clearAll = useCallback(() => {
    setState((prev) => ({ ...prev, base: null, compare: null, pending: null }));
  }, []);

  // Esc：先取消待替换，再清空对比槽。
  const escape = useCallback(() => {
    setState((prev) =>
      prev.pending
        ? { ...prev, pending: null }
        : { ...prev, base: null, compare: null, pending: null },
    );
  }, []);

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
    forgetTab,
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
  twoDot: boolean,
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
        .compare(base.oid, compare.oid, pathFilter.trim() || undefined, twoDot)
        .then((next) => {
          if (current !== seq.current) {
            return;
          }
          if (next.generation !== generation) {
            setError(i18next.t("compare.repoChanged"));
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
              ? i18next.t("compare.refUnresolved")
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
  }, [base?.oid, compare?.oid, generation, pathFilter, twoDot]);

  return { result, loading, error, invalidRef };
}

export function useCompareFileDiff(
  base: CompareSlot | null,
  compare: CompareSlot | null,
  path: string | null,
  generation: number,
  twoDot: boolean,
): { data: FileDiffDto | null; loading: boolean; error: string | null } {
  const [ignoreWhitespace] = useIgnoreWhitespace();
  // 与 useCompareResult 不同：这里无需防抖、generation 失败静默丢弃，走统一骨架。
  return useIpcResource(
    [base?.oid, compare?.oid, path, twoDot, ignoreWhitespace],
    () => ipc.compareFileDiff(base!.oid, compare!.oid, path!, twoDot, ignoreWhitespace),
    {
      enabled: base !== null && compare !== null && path !== null,
      expectedGeneration: generation,
    },
  );
}
